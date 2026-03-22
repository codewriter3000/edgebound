import {
  BOARD_OFFSET_PX,
  CELL_PX,
  GRID_SIZE,
  LATTICE_MAX,
} from '../game/constants'
import { ALL_SPOTS, SPOT_BY_ID } from '../game/board'
import { pieceGlyph } from '../game/rules'
import type { Piece, Phase, Spot } from '../game/types'

interface GameBoardProps {
  phase: Phase
  pieces: Piece[]
  selectedPieceId: string | null
  validMoveTargets: Set<string>
  validPickTargets: Set<string>
  canRenderSetupSpot: (spot: Spot) => boolean
  getSpotClass: (spot: Spot) => string
  handleSpotClick: (spot: Spot) => void
  handlePieceClick: (piece: Piece) => void
}

export default function GameBoard({
  phase,
  pieces,
  selectedPieceId,
  validMoveTargets,
  validPickTargets,
  canRenderSetupSpot,
  getSpotClass,
  handleSpotClick,
  handlePieceClick,
}: GameBoardProps) {
  const centerTopRow = GRID_SIZE / 2 - 1
  const centerBottomRow = GRID_SIZE / 2
  const centerLeftCol = GRID_SIZE / 2 - 1
  const centerRightCol = GRID_SIZE / 2

  function getCellClass(row: number, col: number): string {
    const parity = (row + col) % 2 === 0 ? 'a' : 'b'
    const inCenterBlock =
      (row === centerTopRow || row === centerBottomRow) &&
      (col === centerLeftCol || col === centerRightCol)

    if (inCenterBlock) {
      return `cell center-core ${parity}`
    }

    if ((row === centerTopRow || row === centerBottomRow) && !inCenterBlock) {
      return `cell center-line ${parity}`
    }

    return `cell ${parity === 'a' ? 'dark' : 'light'}`
  }

  return (
    <section className="board-wrap panel">
      <div
        className="board-grid"
        style={{
          width: `${(LATTICE_MAX + 1) * CELL_PX}px`,
          height: `${(LATTICE_MAX + 1) * CELL_PX}px`,
        }}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => {
          const row = Math.floor(index / GRID_SIZE)
          const col = index % GRID_SIZE
          return (
            <div
              key={`${row}-${col}`}
              className={getCellClass(row, col)}
              style={{
                left: `${col * 2 * CELL_PX + BOARD_OFFSET_PX}px`,
                top: `${row * 2 * CELL_PX + BOARD_OFFSET_PX}px`,
                width: `${CELL_PX * 2}px`,
                height: `${CELL_PX * 2}px`,
              }}
            />
          )
        })}

        {ALL_SPOTS.map((spot) => {
          if (phase === 'setup' && !canRenderSetupSpot(spot)) {
            return null
          }

          if (phase === 'play' && !validMoveTargets.has(spot.id)) {
            return null
          }

          return (
            <button
              key={spot.id}
              type="button"
              className={getSpotClass(spot)}
              onClick={() => handleSpotClick(spot)}
              style={{
                left: `${spot.x * CELL_PX + BOARD_OFFSET_PX}px`,
                top: `${spot.y * CELL_PX + BOARD_OFFSET_PX}px`,
              }}
              aria-label={`Spot ${spot.id}`}
            />
          )
        })}

        {pieces.map((piece) => {
          const spot = SPOT_BY_ID.get(piece.spotId)
          if (spot == null) {
            return null
          }

          const isSelected = selectedPieceId === piece.id
          const canPickTarget = validPickTargets.has(piece.id)

          return (
            <button
              key={piece.id}
              type="button"
              onClick={() => handlePieceClick(piece)}
              className={`piece ${piece.owner.toLowerCase()} ${piece.type}${
                piece.locked ? ' locked' : ''
              }${isSelected ? ' selected' : ''}${canPickTarget ? ' pick-target' : ''}`}
              style={{
                left: `${spot.x * CELL_PX + BOARD_OFFSET_PX}px`,
                top: `${spot.y * CELL_PX + BOARD_OFFSET_PX}px`,
              }}
              aria-label={`${piece.owner} ${piece.type}`}
            >
              {pieceGlyph(piece.type)}
            </button>
          )
        })}
      </div>
    </section>
  )
}
