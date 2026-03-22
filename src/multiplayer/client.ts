import type { GameAction, GameState } from '../game/engine'
import {
  parseServerMessage,
  type PresencePlayer,
  type PresenceSpectator,
  type RoomSlot,
  type ServerMessage,
} from './protocol'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

interface MultiplayerClientOptions {
  url: string
  onStatus: (status: ConnectionStatus) => void
  onRoom: (info: {
    roomCode: string
    playerSlot: RoomSlot
    reconnectToken?: string
    state: GameState
    version: number
    spectatorsEnabled: boolean
    abandoned: boolean
  }) => void
  onState: (state: GameState, version: number, lastActionId?: string) => void
  onPresence: (info: {
    players: PresencePlayer[]
    spectators: PresenceSpectator[]
    spectatorsEnabled: boolean
    abandoned: boolean
  }) => void
  onError: (message: string) => void
}

export class MultiplayerClient {
  private socket: WebSocket | null = null
  private readonly options: MultiplayerClientOptions

  constructor(options: MultiplayerClientOptions) {
    this.options = options
  }

  connect(): void {
    this.options.onStatus('connecting')
    this.socket = new WebSocket(this.options.url)

    this.socket.addEventListener('open', () => {
      this.options.onStatus('connected')
    })

    this.socket.addEventListener('close', () => {
      this.options.onStatus('disconnected')
    })

    this.socket.addEventListener('error', () => {
      this.options.onError('Connection error')
    })

    this.socket.addEventListener('message', (event) => {
      const message = parseServerMessage(String(event.data))
      if (message == null) {
        this.options.onError('Received malformed server message')
        return
      }

      this.handleMessage(message)
    })
  }

  disconnect(): void {
    this.socket?.close()
    this.socket = null
  }

  private send(payload: unknown): void {
    if (this.socket == null || this.socket.readyState !== WebSocket.OPEN) {
      this.options.onError('Not connected')
      return
    }

    this.socket.send(JSON.stringify(payload))
  }

  createRoom(displayName: string): void {
    this.send({ type: 'room:create', displayName })
  }

  joinRoom(roomCode: string, displayName: string, reconnectToken?: string): void {
    this.send({
      type: 'room:join',
      roomCode,
      displayName,
      reconnectToken,
    })
  }

  setSpectatorsEnabled(roomCode: string, enabled: boolean): void {
    this.send({
      type: 'room:set-spectators',
      roomCode,
      enabled,
    })
  }

  sendAction(roomCode: string, action: GameAction, actionId: string, clientVersion: number): void {
    this.send({
      type: 'game:action',
      roomCode,
      action,
      actionId,
      clientVersion,
    })
  }

  ping(): void {
    this.send({ type: 'ping' })
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === 'room:created' || message.type === 'room:joined') {
      this.options.onRoom({
        roomCode: message.roomCode,
        playerSlot: message.playerSlot,
        reconnectToken: message.reconnectToken,
        state: message.state,
        version: message.version,
        spectatorsEnabled: message.spectatorsEnabled,
        abandoned: message.abandoned,
      })
      return
    }

    if (message.type === 'game:state') {
      this.options.onState(message.state, message.version, message.lastActionId)
      return
    }

    if (message.type === 'presence:update') {
      this.options.onPresence({
        players: message.players,
        spectators: message.spectators,
        spectatorsEnabled: message.spectatorsEnabled,
        abandoned: message.abandoned,
      })
      return
    }

    if (message.type === 'game:error') {
      this.options.onError(message.message)
    }
  }
}
