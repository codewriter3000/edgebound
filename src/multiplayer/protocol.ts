import type { GameAction, GameState } from '../game/engine'
import type { Player } from '../game/types'

export type RoomSlot = Player | 'spectator'

export interface PresencePlayer {
  slot: Player
  connected: boolean
  displayName: string
}

export interface PresenceSpectator {
  id: string
  displayName: string
}

export type ClientMessage =
  | {
      type: 'room:create'
      displayName: string
    }
  | {
      type: 'room:join'
      roomCode: string
      displayName: string
      reconnectToken?: string
    }
  | {
      type: 'game:action'
      roomCode: string
      action: GameAction
      actionId: string
      clientVersion: number
    }
  | {
      type: 'room:set-spectators'
      roomCode: string
      enabled: boolean
    }
  | {
      type: 'ping'
    }

export type ServerMessage =
  | {
      type: 'room:created'
      roomCode: string
      playerSlot: RoomSlot
      reconnectToken: string
      state: GameState
      version: number
      spectatorsEnabled: boolean
      abandoned: boolean
    }
  | {
      type: 'room:joined'
      roomCode: string
      playerSlot: RoomSlot
      reconnectToken?: string
      state: GameState
      version: number
      spectatorsEnabled: boolean
      abandoned: boolean
    }
  | {
      type: 'game:state'
      state: GameState
      version: number
      lastActionId?: string
    }
  | {
      type: 'game:error'
      actionId?: string
      code: string
      message: string
    }
  | {
      type: 'presence:update'
      players: PresencePlayer[]
      spectators: PresenceSpectator[]
      spectatorsEnabled: boolean
      abandoned: boolean
    }
  | {
      type: 'pong'
    }

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed == null || typeof parsed.type !== 'string') {
      return null
    }

    return parsed as ClientMessage
  } catch {
    return null
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed == null || typeof parsed.type !== 'string') {
      return null
    }

    return parsed as ServerMessage
  } catch {
    return null
  }
}
