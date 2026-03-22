export type Player = 'P1' | 'P2'
export type PieceType = 'triangle' | 'square' | 'circle'
export type SpotKind = 'square' | 'line' | 'corner'
export type Phase = 'setup' | 'play' | 'finished'

export interface Spot {
  id: string
  x: number
  y: number
  kind: SpotKind
}

export interface Piece {
  id: string
  owner: Player
  type: PieceType
  spotId: string
  locked: boolean
  hasMoved: boolean
}
