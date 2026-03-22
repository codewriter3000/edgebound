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
  type PresenceSpectator,
  type RoomSlot,
  type ServerMessage,
} from '../multiplayer/protocol'

const DEFAULT_PORT = Number(process.env.PORT ?? '8787')
const PLAYER_RECONNECT_TIMEOUT_MS = Number(process.env.PLAYER_RECONNECT_TIMEOUT_MS ?? '120000')
const EMPTY_ROOM_TTL_MS = Number(process.env.EMPTY_ROOM_TTL_MS ?? '300000')

interface ConnectionMeta {
  socket: WebSocket
  roomCode: string | null
  slot: RoomSlot | null
  reconnectToken: string | null
  displayName: string
  spectatorId: string | null
}

interface RoomPlayer {
  slot: Player
  reconnectToken: string
  displayName: string
  socket: WebSocket | null
  disconnectTimer: NodeJS.Timeout | null
}

interface RoomSpectator {
  id: string
  displayName: string
  socket: WebSocket
}

interface RoomState {
  code: string
  state: GameState
  version: number
  players: Record<Player, RoomPlayer | null>
  spectators: Map<string, RoomSpectator>
  spectatorsEnabled: boolean
  abandoned: boolean
  processedActionIds: Set<string>
  emptyRoomTimer: NodeJS.Timeout | null
}

export interface MultiplayerServerInstance {
  port: number
  close: () => Promise<void>
}

interface ServerConfig {
  playerReconnectTimeoutMs: number
  emptyRoomTtlMs: number
}

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

function clearTimer(timer: NodeJS.Timeout | null): null {
  if (timer != null) {
    clearTimeout(timer)
  }

  return null
}

function isPlayerSlot(slot: RoomSlot | null): slot is Player {
  return slot === 'P1' || slot === 'P2'
}

function serialize(message: ServerMessage): string {
  return JSON.stringify(message)
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(serialize(message))
  }
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

function getSpectators(room: RoomState): PresenceSpectator[] {
  return [...room.spectators.values()].map((spectator) => ({
    id: spectator.id,
    displayName: spectator.displayName,
  }))
}

export function startMultiplayerServer(port = DEFAULT_PORT, partialConfig?: Partial<ServerConfig>): MultiplayerServerInstance {
  const config: ServerConfig = {
    playerReconnectTimeoutMs: partialConfig?.playerReconnectTimeoutMs ?? PLAYER_RECONNECT_TIMEOUT_MS,
    emptyRoomTtlMs: partialConfig?.emptyRoomTtlMs ?? EMPTY_ROOM_TTL_MS,
  }
  const roomByCode = new Map<string, RoomState>()
  const connectionMeta = new Map<WebSocket, ConnectionMeta>()

  function broadcastParticipants(room: RoomState, message: ServerMessage): void {
    ;(['P1', 'P2'] as Player[]).forEach((slot) => {
      const player = room.players[slot]
      if (player?.socket != null) {
        send(player.socket, message)
      }
    })

    room.spectators.forEach((spectator) => {
      send(spectator.socket, message)
    })
  }

  function broadcastPresence(room: RoomState): void {
    broadcastParticipants(room, {
      type: 'presence:update',
      players: getPresence(room),
      spectators: getSpectators(room),
      spectatorsEnabled: room.spectatorsEnabled,
      abandoned: room.abandoned,
    })
  }

  function hasConnectedParticipants(room: RoomState): boolean {
    const playerConnected = (['P1', 'P2'] as Player[]).some((slot) => room.players[slot]?.socket != null)
    if (playerConnected) {
      return true
    }

    return room.spectators.size > 0
  }

  function scheduleEmptyRoomCleanup(room: RoomState): void {
    if (hasConnectedParticipants(room)) {
      room.emptyRoomTimer = clearTimer(room.emptyRoomTimer)
      return
    }

    if (room.emptyRoomTimer != null) {
      return
    }

    room.emptyRoomTimer = setTimeout(() => {
      const current = roomByCode.get(room.code)
      if (current !== room) {
        return
      }

      if (!hasConnectedParticipants(room)) {
        ;(['P1', 'P2'] as Player[]).forEach((slot) => {
          const player = room.players[slot]
          if (player != null) {
            player.disconnectTimer = clearTimer(player.disconnectTimer)
          }
        })
        roomByCode.delete(room.code)
      }

      room.emptyRoomTimer = null
    }, config.emptyRoomTtlMs)
  }

  function kickAllSpectators(room: RoomState): void {
    room.spectators.forEach((spectator) => {
      spectator.socket.close()
    })
    room.spectators.clear()
  }

  function closeAllConnectedPlayers(room: RoomState): void {
    ;(['P1', 'P2'] as Player[]).forEach((slot) => {
      const player = room.players[slot]
      if (player?.socket != null) {
        player.socket.close()
      }
    })
  }

  function attachSocketToRoom(
    socket: WebSocket,
    roomCode: string,
    slot: RoomSlot,
    reconnectToken: string | null,
    displayName: string,
    spectatorId: string | null,
  ): void {
    connectionMeta.set(socket, {
      socket,
      roomCode,
      slot,
      reconnectToken,
      displayName,
      spectatorId,
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
      disconnectTimer: null,
    }

    const room: RoomState = {
      code,
      state: createInitialGameState(),
      version: 0,
      players: {
        P1: playerOne,
        P2: null,
      },
      spectators: new Map(),
      spectatorsEnabled: true,
      abandoned: false,
      processedActionIds: new Set(),
      emptyRoomTimer: null,
    }

    roomByCode.set(code, room)
    return room
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

  function schedulePlayerSlotRelease(room: RoomState, slot: Player, reconnectToken: string): void {
    const player = room.players[slot]
    if (player == null) {
      return
    }

    player.disconnectTimer = clearTimer(player.disconnectTimer)
    player.disconnectTimer = setTimeout(() => {
      const currentRoom = roomByCode.get(room.code)
      if (currentRoom !== room) {
        return
      }

      const currentPlayer = room.players[slot]
      if (
        currentPlayer != null &&
        currentPlayer.socket == null &&
        currentPlayer.reconnectToken === reconnectToken
      ) {
        room.abandoned = true
        room.spectatorsEnabled = false
        kickAllSpectators(room)
        closeAllConnectedPlayers(room)
        room.players[slot] = null
        broadcastPresence(room)
        scheduleEmptyRoomCleanup(room)
      }
    }, config.playerReconnectTimeoutMs)
  }

  function handleCreate(socket: WebSocket, displayName: unknown): void {
    const room = createRoom(normalizeName(displayName), socket)
    const player = room.players.P1
    if (player == null) {
      reject(socket, 'Failed to create room', 'INTERNAL')
      return
    }

    attachSocketToRoom(socket, room.code, 'P1', player.reconnectToken, player.displayName, null)

    send(socket, {
      type: 'room:created',
      roomCode: room.code,
      playerSlot: 'P1',
      reconnectToken: player.reconnectToken,
      state: room.state,
      version: room.version,
      spectatorsEnabled: room.spectatorsEnabled,
      abandoned: room.abandoned,
    })

    broadcastPresence(room)
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

    if (room.abandoned) {
      reject(socket, 'Room is locked/abandoned', 'ROOM_ABANDONED')
      return
    }

    room.emptyRoomTimer = clearTimer(room.emptyRoomTimer)

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
      if (slot != null) {
        token = randomId(16)
      }
    }

    if (slot == null) {
      if (!room.spectatorsEnabled) {
        reject(socket, 'Spectators are disabled for this room', 'SPECTATORS_DISABLED')
        return
      }

      const spectatorId = randomId(12)
      room.spectators.set(spectatorId, {
        id: spectatorId,
        displayName: safeName,
        socket,
      })

      attachSocketToRoom(socket, room.code, 'spectator', null, safeName, spectatorId)
      send(socket, {
        type: 'room:joined',
        roomCode: room.code,
        playerSlot: 'spectator',
        state: room.state,
        version: room.version,
        spectatorsEnabled: room.spectatorsEnabled,
        abandoned: room.abandoned,
      })
      broadcastPresence(room)
      return
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
      disconnectTimer: existing?.disconnectTimer ?? null,
    }

    joinedPlayer.disconnectTimer = clearTimer(joinedPlayer.disconnectTimer)
    room.players[slot] = joinedPlayer

    attachSocketToRoom(socket, room.code, slot, token, joinedPlayer.displayName, null)

    send(socket, {
      type: 'room:joined',
      roomCode: room.code,
      playerSlot: slot,
      reconnectToken: token,
      state: room.state,
      version: room.version,
      spectatorsEnabled: room.spectatorsEnabled,
      abandoned: room.abandoned,
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

    if (room.abandoned) {
      reject(socket, 'Room is locked/abandoned', 'ROOM_ABANDONED', actionId)
      return
    }

    const meta = connectionMeta.get(socket)
    if (meta?.roomCode !== roomCode || !isPlayerSlot(meta.slot)) {
      reject(socket, 'You are not a player in this room', 'NOT_IN_ROOM', actionId)
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

    broadcastParticipants(room, {
      type: 'game:state',
      state: room.state,
      version: room.version,
      lastActionId: actionId,
    })
  }

  function handleSetSpectators(socket: WebSocket, roomCode: unknown, enabled: unknown): void {
    if (typeof roomCode !== 'string' || typeof enabled !== 'boolean') {
      reject(socket, 'Invalid spectator settings payload')
      return
    }

    const room = roomByCode.get(roomCode)
    if (room == null) {
      reject(socket, 'Room not found', 'ROOM_NOT_FOUND')
      return
    }

    if (room.abandoned) {
      reject(socket, 'Room is locked/abandoned', 'ROOM_ABANDONED')
      return
    }

    const meta = connectionMeta.get(socket)
    if (meta?.roomCode !== roomCode || !isPlayerSlot(meta.slot)) {
      reject(socket, 'Only players can change spectator settings', 'NOT_IN_ROOM')
      return
    }

    room.spectatorsEnabled = enabled
    if (!enabled) {
      kickAllSpectators(room)
    }

    broadcastPresence(room)
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

    if (meta.slot === 'spectator') {
      if (meta.spectatorId != null) {
        room.spectators.delete(meta.spectatorId)
      }
      scheduleEmptyRoomCleanup(room)
      return
    }

    const player = room.players[meta.slot]
    if (player != null && player.socket === socket) {
      player.socket = null
      if (!room.abandoned) {
        schedulePlayerSlotRelease(room, meta.slot, player.reconnectToken)
      }
    }

    broadcastPresence(room)
    scheduleEmptyRoomCleanup(room)
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
      spectatorId: null,
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

      if (message.type === 'room:set-spectators') {
        handleSetSpectators(socket, message.roomCode, message.enabled)
        return
      }

      handleAction(socket, message.roomCode, message.action, message.actionId, message.clientVersion)
    })

    socket.on('close', () => {
      handleDisconnect(socket)
    })
  })

  server.listen(port)

  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        roomByCode.forEach((room) => {
          room.emptyRoomTimer = clearTimer(room.emptyRoomTimer)
          ;(['P1', 'P2'] as Player[]).forEach((slot) => {
            const player = room.players[slot]
            if (player != null) {
              player.disconnectTimer = clearTimer(player.disconnectTimer)
              player.socket?.close()
            }
          })
          room.spectators.forEach((spectator) => spectator.socket.close())
        })

        wss.close((wssError) => {
          if (wssError != null) {
            reject(wssError)
            return
          }

          server.close((serverError) => {
            if (serverError != null) {
              reject(serverError)
              return
            }

            resolve()
          })
        })
      }),
  }
}

if (process.env.NODE_ENV !== 'test') {
  const instance = startMultiplayerServer(DEFAULT_PORT)
  // eslint-disable-next-line no-console
  console.log(`Multiplayer server listening on :${instance.port}`)
}
