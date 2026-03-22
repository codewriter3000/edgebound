import type { PieceType } from './types'

export const GRID_SIZE = 10
export const LATTICE_MAX = GRID_SIZE * 2
export const CELL_PX = 34
export const BOARD_OFFSET_PX = CELL_PX / 2
export const MAX_MOVES_PER_TURN = 4
export const MAX_FIRST_TURN_ACTIONS = 3

export const PIECE_LIMITS: Record<PieceType, number> = {
  triangle: 4,
  square: 3,
  circle: 2,
}

export const MOVE_RANGE: Record<PieceType, number> = {
  triangle: 1,
  square: 2,
  circle: 3,
}

export const PICK_RANGE: Record<PieceType, number> = {
  triangle: 1,
  square: 2,
  circle: 3,
}

export const SHAPES: PieceType[] = ['triangle', 'square', 'circle']
