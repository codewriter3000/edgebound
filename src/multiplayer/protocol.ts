import type { GameAction, GameState } from '../game/engine'
import type { Player } from '../game/types'

export interface PresencePlayer {
  slot: Player
  connected: boolean
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
      type: 'ping'
    }

export type ServerMessage =
  | {
      type: 'room:created'
      roomCode: string
      playerSlot: Player
      reconnectToken: string
      state: GameState
      version: number
    }
  | {
      type: 'room:joined'
      roomCode: string
      playerSlot: Player
      reconnectToken: string
      state: GameState
      version: number
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
