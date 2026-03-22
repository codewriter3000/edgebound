import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { applyGameAction, createInitialGameState, } from '../game/engine';
import { parseClientMessage, } from '../multiplayer/protocol';
const PORT = Number(process.env.PORT ?? '8787');
const roomByCode = new Map();
const connectionMeta = new Map();
function randomId(bytes = 8) {
    return randomBytes(bytes).toString('hex');
}
function makeRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
}
function createRoom(displayName, socket) {
    let code = makeRoomCode();
    while (roomByCode.has(code)) {
        code = makeRoomCode();
    }
    const playerOne = {
        slot: 'P1',
        reconnectToken: randomId(16),
        displayName,
        socket,
    };
    const room = {
        code,
        state: createInitialGameState(),
        version: 0,
        players: {
            P1: playerOne,
            P2: null,
        },
        processedActionIds: new Set(),
    };
    roomByCode.set(code, room);
    return room;
}
function serialize(message) {
    return JSON.stringify(message);
}
function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(serialize(message));
    }
}
function getPresence(room) {
    return ['P1', 'P2']
        .map((slot) => room.players[slot])
        .filter((value) => value != null)
        .map((player) => ({
        slot: player.slot,
        connected: player.socket != null,
        displayName: player.displayName,
    }));
}
function broadcastRoom(room, message) {
    ;
    ['P1', 'P2'].forEach((slot) => {
        const player = room.players[slot];
        if (player?.socket != null) {
            send(player.socket, message);
        }
    });
}
function broadcastPresence(room) {
    broadcastRoom(room, {
        type: 'presence:update',
        players: getPresence(room),
    });
}
function attachSocketToRoom(socket, roomCode, slot, reconnectToken, displayName) {
    connectionMeta.set(socket, {
        socket,
        roomCode,
        slot,
        reconnectToken,
        displayName,
    });
}
function reject(socket, message, code = 'BAD_REQUEST', actionId) {
    send(socket, {
        type: 'game:error',
        code,
        message,
        actionId,
    });
}
function normalizeName(name) {
    if (typeof name !== 'string') {
        return 'Player';
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return 'Player';
    }
    return trimmed.slice(0, 24);
}
function handleCreate(socket, displayName) {
    const room = createRoom(normalizeName(displayName), socket);
    const player = room.players.P1;
    if (player == null) {
        reject(socket, 'Failed to create room', 'INTERNAL');
        return;
    }
    attachSocketToRoom(socket, room.code, 'P1', player.reconnectToken, player.displayName);
    send(socket, {
        type: 'room:created',
        roomCode: room.code,
        playerSlot: 'P1',
        reconnectToken: player.reconnectToken,
        state: room.state,
        version: room.version,
    });
    broadcastPresence(room);
}
function findReconnectSlot(room, reconnectToken) {
    for (const slot of ['P1', 'P2']) {
        const player = room.players[slot];
        if (player?.reconnectToken === reconnectToken) {
            return slot;
        }
    }
    return null;
}
function firstOpenSlot(room) {
    if (room.players.P1 == null) {
        return 'P1';
    }
    if (room.players.P2 == null) {
        return 'P2';
    }
    return null;
}
function handleJoin(socket, roomCode, displayName, reconnectToken) {
    if (typeof roomCode !== 'string') {
        reject(socket, 'roomCode is required');
        return;
    }
    const room = roomByCode.get(roomCode);
    if (room == null) {
        reject(socket, 'Room not found', 'ROOM_NOT_FOUND');
        return;
    }
    const safeName = normalizeName(displayName);
    let slot = null;
    let token = null;
    if (typeof reconnectToken === 'string') {
        const reconnectSlot = findReconnectSlot(room, reconnectToken);
        if (reconnectSlot != null) {
            slot = reconnectSlot;
            token = reconnectToken;
        }
    }
    if (slot == null) {
        slot = firstOpenSlot(room);
        if (slot == null) {
            reject(socket, 'Room is full', 'ROOM_FULL');
            return;
        }
        token = randomId(16);
    }
    if (token == null) {
        reject(socket, 'Failed to establish reconnect token', 'INTERNAL');
        return;
    }
    const existing = room.players[slot];
    const joinedPlayer = {
        slot,
        reconnectToken: token,
        displayName: existing?.displayName ?? safeName,
        socket,
    };
    room.players[slot] = joinedPlayer;
    attachSocketToRoom(socket, room.code, slot, token, joinedPlayer.displayName);
    send(socket, {
        type: 'room:joined',
        roomCode: room.code,
        playerSlot: slot,
        reconnectToken: token,
        state: room.state,
        version: room.version,
    });
    broadcastPresence(room);
}
function handleAction(socket, roomCode, action, actionId, clientVersion) {
    if (typeof roomCode !== 'string' ||
        typeof actionId !== 'string' ||
        typeof clientVersion !== 'number') {
        reject(socket, 'Invalid action payload');
        return;
    }
    const room = roomByCode.get(roomCode);
    if (room == null) {
        reject(socket, 'Room not found', 'ROOM_NOT_FOUND', actionId);
        return;
    }
    const meta = connectionMeta.get(socket);
    if (meta?.roomCode !== roomCode || meta.slot == null) {
        reject(socket, 'You are not in this room', 'NOT_IN_ROOM', actionId);
        return;
    }
    if (clientVersion > room.version) {
        reject(socket, 'Client version ahead of server', 'VERSION_CONFLICT', actionId);
        return;
    }
    if (room.processedActionIds.has(actionId)) {
        send(socket, {
            type: 'game:state',
            state: room.state,
            version: room.version,
            lastActionId: actionId,
        });
        return;
    }
    if (typeof action !== 'object' || action == null || typeof action.type !== 'string') {
        reject(socket, 'Invalid action');
        return;
    }
    const result = applyGameAction(room.state, meta.slot, action);
    if (!result.accepted) {
        reject(socket, result.error ?? 'Action rejected', 'ACTION_REJECTED', actionId);
        return;
    }
    room.state = result.state;
    room.version += 1;
    room.processedActionIds.add(actionId);
    broadcastRoom(room, {
        type: 'game:state',
        state: room.state,
        version: room.version,
        lastActionId: actionId,
    });
}
function handleDisconnect(socket) {
    const meta = connectionMeta.get(socket);
    connectionMeta.delete(socket);
    if (meta?.roomCode == null || meta.slot == null) {
        return;
    }
    const room = roomByCode.get(meta.roomCode);
    if (room == null) {
        return;
    }
    const player = room.players[meta.slot];
    if (player != null && player.socket === socket) {
        player.socket = null;
    }
    broadcastPresence(room);
}
const server = createServer();
const wss = new WebSocketServer({ server });
wss.on('connection', (socket) => {
    connectionMeta.set(socket, {
        socket,
        roomCode: null,
        slot: null,
        reconnectToken: null,
        displayName: 'Player',
    });
    socket.on('message', (buffer) => {
        const raw = String(buffer);
        const message = parseClientMessage(raw);
        if (message == null) {
            reject(socket, 'Malformed message');
            return;
        }
        if (message.type === 'ping') {
            send(socket, { type: 'pong' });
            return;
        }
        if (message.type === 'room:create') {
            handleCreate(socket, message.displayName);
            return;
        }
        if (message.type === 'room:join') {
            handleJoin(socket, message.roomCode, message.displayName, message.reconnectToken);
            return;
        }
        handleAction(socket, message.roomCode, message.action, message.actionId, message.clientVersion);
    });
    socket.on('close', () => {
        handleDisconnect(socket);
    });
});
server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Multiplayer server listening on :${PORT}`);
});
