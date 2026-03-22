import { parseServerMessage, } from './protocol';
export class MultiplayerClient {
    socket = null;
    options;
    constructor(options) {
        this.options = options;
    }
    connect() {
        this.options.onStatus('connecting');
        this.socket = new WebSocket(this.options.url);
        this.socket.addEventListener('open', () => {
            this.options.onStatus('connected');
        });
        this.socket.addEventListener('close', () => {
            this.options.onStatus('disconnected');
        });
        this.socket.addEventListener('error', () => {
            this.options.onError('Connection error');
        });
        this.socket.addEventListener('message', (event) => {
            const message = parseServerMessage(String(event.data));
            if (message == null) {
                this.options.onError('Received malformed server message');
                return;
            }
            this.handleMessage(message);
        });
    }
    disconnect() {
        this.socket?.close();
        this.socket = null;
    }
    send(payload) {
        if (this.socket == null || this.socket.readyState !== WebSocket.OPEN) {
            this.options.onError('Not connected');
            return;
        }
        this.socket.send(JSON.stringify(payload));
    }
    createRoom(displayName) {
        this.send({ type: 'room:create', displayName });
    }
    joinRoom(roomCode, displayName, reconnectToken) {
        this.send({
            type: 'room:join',
            roomCode,
            displayName,
            reconnectToken,
        });
    }
    sendAction(roomCode, action, actionId, clientVersion) {
        this.send({
            type: 'game:action',
            roomCode,
            action,
            actionId,
            clientVersion,
        });
    }
    ping() {
        this.send({ type: 'ping' });
    }
    handleMessage(message) {
        if (message.type === 'room:created' || message.type === 'room:joined') {
            this.options.onRoom({
                roomCode: message.roomCode,
                playerSlot: message.playerSlot,
                reconnectToken: message.reconnectToken,
                state: message.state,
                version: message.version,
            });
            return;
        }
        if (message.type === 'game:state') {
            this.options.onState(message.state, message.version, message.lastActionId);
            return;
        }
        if (message.type === 'presence:update') {
            this.options.onPresence(message.players);
            return;
        }
        if (message.type === 'game:error') {
            this.options.onError(message.message);
        }
    }
}
