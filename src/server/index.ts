import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import {
  applyGameAction,
  createInitialGameState,
  type GameState,
} from '../game/engine'
import type { Player } from '../game/types'
import {
  parseClientMessage,
  type PresencePlayer,
  type ServerMessage,
} from '../multiplayer/protocol'

interface ConnectionMeta {
  socket: WebSocket
  roomCode: string | null
  slot: Player | null
  reconnectToken: string | null
  displayName: string
}

interface RoomPlayer {
  slot: Player
  reconnectToken: string
  displayName: string
  socket: WebSocket | null
}

interface RoomState {
  code: string
  state: GameState
  version: number
  players: Record<Player, RoomPlayer | null>
  processedActionIds: Set<string>
}

const PORT = Number(process.env.PORT ?? '8787')
const roomByCode = new Map<string, RoomState>()
const connectionMeta = new Map<WebSocket, ConnectionMeta>()

function randomId(bytes = 8): string {
  return randomBytes(bytes).toString('hex')
}

function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }

  return code
}

function createRoom(displayName: string, socket: WebSocket): RoomState {
  let code = makeRoomCode()
  while (roomByCode.has(code)) {
    code = makeRoomCode()
  }

  const playerOne: RoomPlayer = {
    slot: 'P1',
    reconnectToken: randomId(16),
    displayName,
    socket,
  }

  const room: RoomState = {
    code,
    state: createInitialGameState(),
    version: 0,
    players: {
      P1: playerOne,
      P2: null,
    },
    processedActionIds: new Set(),
  }

  roomByCode.set(code, room)
  return room
}

function serialize(message: ServerMessage): string {
  return JSON.stringify(message)
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(serialize(message))
  }
}

function getPresence(room: RoomState): PresencePlayer[] {
  return (['P1', 'P2'] as Player[])
    .map((slot) => room.players[slot])
    .filter((value): value is RoomPlayer => value != null)
    .map((player) => ({
      slot: player.slot,
      connected: player.socket != null,
      displayName: player.displayName,
    }))
}

function broadcastRoom(room: RoomState, message: ServerMessage): void {
  ;(['P1', 'P2'] as Player[]).forEach((slot) => {
    const player = room.players[slot]
    if (player?.socket != null) {
      send(player.socket, message)
    }
  })
}

function broadcastPresence(room: RoomState): void {
  broadcastRoom(room, {
    type: 'presence:update',
    players: getPresence(room),
  })
}

function attachSocketToRoom(
  socket: WebSocket,
  roomCode: string,
  slot: Player,
  reconnectToken: string,
  displayName: string,
): void {
  connectionMeta.set(socket, {
    socket,
    roomCode,
    slot,
    reconnectToken,
    displayName,
  })
}

function reject(socket: WebSocket, message: string, code = 'BAD_REQUEST', actionId?: string): void {
  send(socket, {
    type: 'game:error',
    code,
    message,
    actionId,
  })
}

function normalizeName(name: unknown): string {
  if (typeof name !== 'string') {
    return 'Player'
  }

  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return 'Player'
  }

  return trimmed.slice(0, 24)
}

function handleCreate(socket: WebSocket, displayName: unknown): void {
  const room = createRoom(normalizeName(displayName), socket)
  const player = room.players.P1
  if (player == null) {
    reject(socket, 'Failed to create room', 'INTERNAL')
    return
  }

  attachSocketToRoom(socket, room.code, 'P1', player.reconnectToken, player.displayName)

  send(socket, {
    type: 'room:created',
    roomCode: room.code,
    playerSlot: 'P1',
    reconnectToken: player.reconnectToken,
    state: room.state,
    version: room.version,
  })

  broadcastPresence(room)
}

function findReconnectSlot(room: RoomState, reconnectToken: string): Player | null {
  for (const slot of ['P1', 'P2'] as Player[]) {
    const player = room.players[slot]
    if (player?.reconnectToken === reconnectToken) {
      return slot
    }
  }

  return null
}

function firstOpenSlot(room: RoomState): Player | null {
  if (room.players.P1 == null) {
    return 'P1'
  }

  if (room.players.P2 == null) {
    return 'P2'
  }

  return null
}

function handleJoin(
  socket: WebSocket,
  roomCode: unknown,
  displayName: unknown,
  reconnectToken: unknown,
): void {
  if (typeof roomCode !== 'string') {
    reject(socket, 'roomCode is required')
    return
  }

  const room = roomByCode.get(roomCode)
  if (room == null) {
    reject(socket, 'Room not found', 'ROOM_NOT_FOUND')
    return
  }

  const safeName = normalizeName(displayName)
  let slot: Player | null = null
  let token: string | null = null

  if (typeof reconnectToken === 'string') {
    const reconnectSlot = findReconnectSlot(room, reconnectToken)
    if (reconnectSlot != null) {
      slot = reconnectSlot
      token = reconnectToken
    }
  }

  if (slot == null) {
    slot = firstOpenSlot(room)
    if (slot == null) {
      reject(socket, 'Room is full', 'ROOM_FULL')
      return
    }

    token = randomId(16)
  }

  if (token == null) {
    reject(socket, 'Failed to establish reconnect token', 'INTERNAL')
    return
  }

  const existing = room.players[slot]
  const joinedPlayer: RoomPlayer = {
    slot,
    reconnectToken: token,
    displayName: existing?.displayName ?? safeName,
    socket,
  }

  room.players[slot] = joinedPlayer

  attachSocketToRoom(socket, room.code, slot, token, joinedPlayer.displayName)

  send(socket, {
    type: 'room:joined',
    roomCode: room.code,
    playerSlot: slot,
    reconnectToken: token,
    state: room.state,
    version: room.version,
  })

  broadcastPresence(room)
}

function handleAction(
  socket: WebSocket,
  roomCode: unknown,
  action: unknown,
  actionId: unknown,
  clientVersion: unknown,
): void {
  if (
    typeof roomCode !== 'string' ||
    typeof actionId !== 'string' ||
    typeof clientVersion !== 'number'
  ) {
    reject(socket, 'Invalid action payload')
    return
  }

  const room = roomByCode.get(roomCode)
  if (room == null) {
    reject(socket, 'Room not found', 'ROOM_NOT_FOUND', actionId)
    return
  }

  const meta = connectionMeta.get(socket)
  if (meta?.roomCode !== roomCode || meta.slot == null) {
    reject(socket, 'You are not in this room', 'NOT_IN_ROOM', actionId)
    return
  }

  if (clientVersion > room.version) {
    reject(socket, 'Client version ahead of server', 'VERSION_CONFLICT', actionId)
    return
  }

  if (room.processedActionIds.has(actionId)) {
    send(socket, {
      type: 'game:state',
      state: room.state,
      version: room.version,
      lastActionId: actionId,
    })
    return
  }

  if (typeof action !== 'object' || action == null || typeof (action as { type?: unknown }).type !== 'string') {
    reject(socket, 'Invalid action')
    return
  }

  const result = applyGameAction(room.state, meta.slot, action as Parameters<typeof applyGameAction>[2])
  if (!result.accepted) {
    reject(socket, result.error ?? 'Action rejected', 'ACTION_REJECTED', actionId)
    return
  }

  room.state = result.state
  room.version += 1
  room.processedActionIds.add(actionId)

  broadcastRoom(room, {
    type: 'game:state',
    state: room.state,
    version: room.version,
    lastActionId: actionId,
  })
}

function handleDisconnect(socket: WebSocket): void {
  const meta = connectionMeta.get(socket)
  connectionMeta.delete(socket)

  if (meta?.roomCode == null || meta.slot == null) {
    return
  }

  const room = roomByCode.get(meta.roomCode)
  if (room == null) {
    return
  }

  const player = room.players[meta.slot]
  if (player != null && player.socket === socket) {
    player.socket = null
  }

  broadcastPresence(room)
}

const server = createServer()
const wss = new WebSocketServer({ server })

wss.on('connection', (socket) => {
  connectionMeta.set(socket, {
    socket,
    roomCode: null,
    slot: null,
    reconnectToken: null,
    displayName: 'Player',
  })

  socket.on('message', (buffer) => {
    const raw = String(buffer)
    const message = parseClientMessage(raw)

    if (message == null) {
      reject(socket, 'Malformed message')
      return
    }

    if (message.type === 'ping') {
      send(socket, { type: 'pong' })
      return
    }

    if (message.type === 'room:create') {
      handleCreate(socket, message.displayName)
      return
    }

    if (message.type === 'room:join') {
      handleJoin(socket, message.roomCode, message.displayName, message.reconnectToken)
      return
    }

    handleAction(socket, message.roomCode, message.action, message.actionId, message.clientVersion)
  })

  socket.on('close', () => {
    handleDisconnect(socket)
  })
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Multiplayer server listening on :${PORT}`)
})
