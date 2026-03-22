import { MAX_MOVES_PER_TURN, PICK_RANGE } from './constants'
import { SPOT_BY_ID } from './board'
import { isEdgeSpot, isPathClear } from './rules'
import type { Phase, Piece, Player, Spot, SpotKind } from './types'

interface MoveCandidate {
  dx: number
  dy: number
  endKinds: SpotKind[]
}

const EIGHT_DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

export function buildOccupancyMap(pieces: Piece[]): Map<string, Piece[]> {
  const map = new Map<string, Piece[]>()

  pieces.forEach((piece) => {
    const list = map.get(piece.spotId) ?? []
    list.push(piece)
    map.set(piece.spotId, list)
  })

  return map
}

function buildMoveCandidates(piece: Piece, origin: Spot): MoveCandidate[] {
  const candidates: MoveCandidate[] = []

  if (piece.type === 'triangle') {
    EIGHT_DIRECTIONS.forEach(([dirX, dirY]) => {
      candidates.push(
        {
          dx: dirX * 2,
          dy: dirY * 2,
          endKinds: ['square', 'line', 'corner'],
        },
        {
          dx: dirX,
          dy: dirY,
          endKinds: ['square', 'line', 'corner'],
        },
      )
    })

    return candidates
  }

  const maxStep = piece.type === 'square' ? 2 : 3

  if (origin.kind === 'square') {
    for (let step = 1; step <= maxStep; step += 1) {
      const delta = step * 2
      EIGHT_DIRECTIONS.forEach(([dirX, dirY]) => {
        candidates.push({
          dx: dirX * delta,
          dy: dirY * delta,
          endKinds: ['square'],
        })
      })
    }

    return candidates
  }

  const isHorizontalLine = origin.kind === 'line' && origin.y % 2 === 0
  const isVerticalLine = origin.kind === 'line' && origin.x % 2 === 0

  for (let step = 1; step <= maxStep; step += 1) {
    const delta = step * 2 + 1

    if (isHorizontalLine) {
      candidates.push(
        { dx: delta, dy: 0, endKinds: ['square'] },
        { dx: -delta, dy: 0, endKinds: ['square'] },
        { dx: 1, dy: delta, endKinds: ['square'] },
        { dx: -1, dy: delta, endKinds: ['square'] },
        { dx: 1, dy: -delta, endKinds: ['square'] },
        { dx: -1, dy: -delta, endKinds: ['square'] },
      )
    } else if (isVerticalLine) {
      candidates.push(
        { dx: 0, dy: delta, endKinds: ['square'] },
        { dx: 0, dy: -delta, endKinds: ['square'] },
        { dx: delta, dy: 1, endKinds: ['square'] },
        { dx: delta, dy: -1, endKinds: ['square'] },
        { dx: -delta, dy: 1, endKinds: ['square'] },
        { dx: -delta, dy: -1, endKinds: ['square'] },
      )
    } else {
      candidates.push(
        { dx: delta, dy: 0, endKinds: ['square'] },
        { dx: -delta, dy: 0, endKinds: ['square'] },
        { dx: 0, dy: delta, endKinds: ['square'] },
        { dx: 0, dy: -delta, endKinds: ['square'] },
        { dx: 1, dy: delta, endKinds: ['square'] },
        { dx: -1, dy: delta, endKinds: ['square'] },
        { dx: 1, dy: -delta, endKinds: ['square'] },
        { dx: -1, dy: -delta, endKinds: ['square'] },
        { dx: delta, dy: 1, endKinds: ['square'] },
        { dx: delta, dy: -1, endKinds: ['square'] },
        { dx: -delta, dy: 1, endKinds: ['square'] },
        { dx: -delta, dy: -1, endKinds: ['square'] },
      )
    }
  }

  return candidates
}

function respectsFriendlySpacing(
  nextSpot: Spot,
  movingPiece: Piece,
  pieces: Piece[],
  isPickAction: boolean,
): boolean {
  if (isPickAction) {
    return true
  }

  return pieces.every((piece) => {
    if (piece.id === movingPiece.id || piece.owner !== movingPiece.owner) {
      return true
    }

    const other = SPOT_BY_ID.get(piece.spotId)
    if (other == null) {
      return true
    }

    const distance = Math.hypot(nextSpot.x - other.x, nextSpot.y - other.y)
    return distance >= 2
  })
}

interface ValidMoveTargetArgs {
  phase: Phase
  actionMode: 'move' | 'pick'
  actionsUsed: number
  turn: Player
  selectedPiece: Piece | null
  actedPieceIds: string[]
  pieces: Piece[]
  occupancy: Map<string, Piece[]>
  blockedPickPointIds: Set<string>
}

export function computeValidMoveTargets({
  phase,
  actionMode,
  actionsUsed,
  turn,
  selectedPiece,
  actedPieceIds,
  pieces,
  occupancy,
  blockedPickPointIds,
}: ValidMoveTargetArgs): Set<string> {
  const targets = new Set<string>()

  if (phase !== 'play' || selectedPiece == null || actionMode !== 'move') {
    return targets
  }

  if (
    actionsUsed >= MAX_MOVES_PER_TURN ||
    selectedPiece.owner !== turn ||
    selectedPiece.locked ||
    actedPieceIds.includes(selectedPiece.id)
  ) {
    return targets
  }

  const origin = SPOT_BY_ID.get(selectedPiece.spotId)
  if (origin == null) {
    return targets
  }

  const candidates = buildMoveCandidates(selectedPiece, origin)

  candidates.forEach(({ dx, dy, endKinds }) => {
    const nx = origin.x + dx
    const ny = origin.y + dy
    const targetId = `${nx}-${ny}`
    const targetSpot = SPOT_BY_ID.get(targetId)
    if (targetSpot == null) {
      return
    }

    if (!endKinds.includes(targetSpot.kind)) {
      return
    }

    const targetPieces = occupancy.get(targetId) ?? []
    const friendlyAtTarget = targetPieces.some((piece) => piece.owner === turn)
    const enemyAtTarget = targetPieces.some((piece) => piece.owner !== turn && !piece.locked)

    if (friendlyAtTarget) {
      return
    }

    if (blockedPickPointIds.has(targetId)) {
      return
    }

    if (
      (selectedPiece.type === 'square' || selectedPiece.type === 'circle') &&
      isEdgeSpot(targetSpot) &&
      !enemyAtTarget
    ) {
      return
    }

    if (!isPathClear(origin, targetSpot, occupancy, blockedPickPointIds)) {
      return
    }

    if (!respectsFriendlySpacing(targetSpot, selectedPiece, pieces, enemyAtTarget)) {
      return
    }

    targets.add(targetId)
  })

  return targets
}

interface ValidPickTargetArgs {
  phase: Phase
  actionMode: 'move' | 'pick'
  turn: Player
  selectedPiece: Piece | null
  actedPieceIds: string[]
  pieces: Piece[]
  occupancy: Map<string, Piece[]>
  blockedPickPointIds: Set<string>
}

export function computeValidPickTargets({
  phase,
  actionMode,
  turn,
  selectedPiece,
  actedPieceIds,
  pieces,
  occupancy,
  blockedPickPointIds,
}: ValidPickTargetArgs): Set<string> {
  const targets = new Set<string>()

  if (phase !== 'play' || selectedPiece == null || actionMode !== 'pick') {
    return targets
  }

  if (
    selectedPiece.owner !== turn ||
    selectedPiece.locked ||
    actedPieceIds.includes(selectedPiece.id)
  ) {
    return targets
  }

  const origin = SPOT_BY_ID.get(selectedPiece.spotId)
  if (origin == null) {
    return targets
  }

  pieces.forEach((piece) => {
    if (piece.owner === turn || piece.locked) {
      return
    }

    const target = SPOT_BY_ID.get(piece.spotId)
    if (target == null || blockedPickPointIds.has(target.id)) {
      return
    }

    const dx = Math.abs(target.x - origin.x)
    const dy = Math.abs(target.y - origin.y)

    if (selectedPiece.type === 'triangle') {
      const distance = Math.hypot(dx, dy)
      const isWithinOneSpaceAnyAngle = distance > 0 && distance <= 2

      if (!isWithinOneSpaceAnyAngle) {
        return
      }
    } else {
      const pickDelta = PICK_RANGE[selectedPiece.type] * 2
      const isOrthogonal =
        (dx > 0 && dx <= pickDelta && dy === 0) ||
        (dy > 0 && dy <= pickDelta && dx === 0)
      const isDiagonal = dx > 0 && dx <= pickDelta && dx === dy

      if (!isOrthogonal && !isDiagonal) {
        return
      }
    }

    if (!isPathClear(origin, target, occupancy, blockedPickPointIds)) {
      return
    }

    targets.add(piece.id)
  })

  return targets
}
