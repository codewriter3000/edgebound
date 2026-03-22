import type { GameState, GameAction } from '../game/engine'
import { buildOccupancyMap, computeValidMoveTargets, computeValidPickTargets } from '../game/movement'
import { canPlaceInSetup, hasRequiredSetupSpacing } from '../game/rules'
import { SPOT_BY_ID, ALL_SPOTS } from '../game/board'
import { PIECE_LIMITS, SHAPES } from '../game/constants'
import type { Player, PieceType } from '../game/types'

export type StrategyKind = 'random' | 'aggressive' | 'defensive'

export interface AgentConfig {
  name: string
  strategy: StrategyKind
}

function setupCounts(pieces: GameState['pieces']) {
  const counts = {
    P1: { triangle: 0, square: 0, circle: 0 },
    P2: { triangle: 0, square: 0, circle: 0 },
  }
  for (const piece of pieces) {
    counts[piece.owner][piece.type] += 1
  }
  return counts
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function getSetupAction(state: GameState, player: Player): GameAction | null {
  const counts = setupCounts(state.pieces)
  const ownPieces = state.pieces.filter((p) => p.owner === player)

  for (const shape of SHAPES) {
    if (counts[player][shape] >= PIECE_LIMITS[shape]) continue

    const validSpots = ALL_SPOTS.filter((spot) => {
      if (SPOT_BY_ID.get(spot.id) == null) return false
      const occupancy = buildOccupancyMap(state.pieces)
      if ((occupancy.get(spot.id)?.length ?? 0) > 0) return false
      if (!canPlaceInSetup(spot, player)) return false
      if (!hasRequiredSetupSpacing(spot, ownPieces)) return false
      return true
    })

    if (validSpots.length === 0) continue
    const chosen = pickRandom(validSpots)
    return { type: 'PLACE_PIECE', pieceType: shape as PieceType, spotId: chosen.id }
  }

  return null
}

function getPlayAction(state: GameState, player: Player, strategy: StrategyKind): GameAction | null {
  const occupancy = buildOccupancyMap(state.pieces)
  const blockedPickPointIds = new Set(state.pickPointIds)
  const ownPieces = state.pieces.filter(
    (p) => p.owner === player && !p.locked && !state.actedPieceIds.includes(p.id),
  )

  if (ownPieces.length === 0) {
    return { type: 'END_TURN' }
  }

  type MoveOption = { pieceId: string; targetSpotId: string }
  type PickOption = { pieceId: string; targetPieceId: string }

  const allMoves: MoveOption[] = []
  const allPicks: PickOption[] = []

  for (const piece of ownPieces) {
    const moveTargets = computeValidMoveTargets({
      phase: state.phase,
      actionMode: 'move',
      actionsUsed: state.actionsUsed,
      turn: state.turn,
      selectedPiece: piece,
      actedPieceIds: state.actedPieceIds,
      pieces: state.pieces,
      occupancy,
      blockedPickPointIds,
    })

    for (const targetSpotId of moveTargets) {
      allMoves.push({ pieceId: piece.id, targetSpotId })
    }

    const pickTargets = computeValidPickTargets({
      phase: state.phase,
      actionMode: 'pick',
      turn: state.turn,
      selectedPiece: piece,
      actedPieceIds: state.actedPieceIds,
      pieces: state.pieces,
      occupancy,
      blockedPickPointIds,
    })

    for (const targetPieceId of pickTargets) {
      allPicks.push({ pieceId: piece.id, targetPieceId })
    }
  }

  if (allMoves.length === 0 && allPicks.length === 0) {
    return { type: 'END_TURN' }
  }

  if (strategy === 'aggressive') {
    if (allPicks.length > 0) {
      const pick = pickRandom(allPicks)
      return { type: 'PICK_PIECE', pieceId: pick.pieceId, targetPieceId: pick.targetPieceId }
    }

    const goalY = player === 'P1' ? 1 : 19
    const forwardMoves = allMoves.filter((m) => {
      const spot = SPOT_BY_ID.get(m.targetSpotId)
      if (!spot) return false
      const piece = state.pieces.find((p) => p.id === m.pieceId)
      if (!piece) return false
      const origin = SPOT_BY_ID.get(piece.spotId)
      if (!origin) return false
      return player === 'P1'
        ? spot.y < origin.y
        : spot.y > origin.y
    })

    if (forwardMoves.length > 0) {
      const bestForward = forwardMoves.reduce((best, move) => {
        const bestSpot = SPOT_BY_ID.get(best.targetSpotId)!
        const moveSpot = SPOT_BY_ID.get(move.targetSpotId)!
        const bestDist = Math.abs(bestSpot.y - goalY)
        const moveDist = Math.abs(moveSpot.y - goalY)
        return moveDist < bestDist ? move : best
      })
      return { type: 'MOVE_TO_SPOT', pieceId: bestForward.pieceId, targetSpotId: bestForward.targetSpotId }
    }

    const move = pickRandom(allMoves)
    return { type: 'MOVE_TO_SPOT', pieceId: move.pieceId, targetSpotId: move.targetSpotId }
  }

  if (strategy === 'defensive') {
    const forwardMoves = allMoves.filter((m) => {
      const spot = SPOT_BY_ID.get(m.targetSpotId)
      if (!spot) return false
      const piece = state.pieces.find((p) => p.id === m.pieceId)
      if (!piece) return false
      const origin = SPOT_BY_ID.get(piece.spotId)
      if (!origin) return false
      return player === 'P1' ? spot.y < origin.y : spot.y > origin.y
    })

    if (forwardMoves.length > 0) {
      const move = pickRandom(forwardMoves)
      return { type: 'MOVE_TO_SPOT', pieceId: move.pieceId, targetSpotId: move.targetSpotId }
    }

    if (allMoves.length > 0) {
      const move = pickRandom(allMoves)
      return { type: 'MOVE_TO_SPOT', pieceId: move.pieceId, targetSpotId: move.targetSpotId }
    }

    if (allPicks.length > 0) {
      const pick = pickRandom(allPicks)
      return { type: 'PICK_PIECE', pieceId: pick.pieceId, targetPieceId: pick.targetPieceId }
    }

    return { type: 'END_TURN' }
  }

  // Random strategy
  const allActions: GameAction[] = [
    ...allMoves.map((m) => ({ type: 'MOVE_TO_SPOT' as const, pieceId: m.pieceId, targetSpotId: m.targetSpotId })),
    ...allPicks.map((p) => ({ type: 'PICK_PIECE' as const, pieceId: p.pieceId, targetPieceId: p.targetPieceId })),
  ]

  return pickRandom(allActions)
}

export function chooseAction(state: GameState, player: Player, config: AgentConfig): GameAction | null {
  if (state.phase === 'setup') {
    return getSetupAction(state, player)
  }

  if (state.phase === 'play') {
    return getPlayAction(state, player, config.strategy)
  }

  return null
}
