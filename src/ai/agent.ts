import type { GameState, GameAction } from '../game/engine'
import { buildOccupancyMap, computeValidMoveTargets, computeValidPickTargets } from '../game/movement'
import { canPlaceInSetup, hasRequiredSetupSpacing } from '../game/rules'
import { SPOT_BY_ID, ALL_SPOTS } from '../game/board'
import { PIECE_LIMITS, SHAPES, LATTICE_MAX } from '../game/constants'
import type { Player, PieceType, Spot } from '../game/types'
import type { LearnedWeights } from './learning'
import { pickStrategy } from './learning'

const P1_GOAL_Y = 1
const P2_GOAL_Y = LATTICE_MAX - 1
const MIDPOINT_Y = LATTICE_MAX / 2
const INITIAL_PIECE_COUNT = Object.values(PIECE_LIMITS).reduce((sum, n) => sum + n, 0) * 2

export type SetupStrategy = 'wide-spread' | 'clustered-narrow' | 'front-loaded' | 'balanced'
export type OpeningStrategy = 'early-pick' | 'rush' | 'hold' | 'mixed-opening'
export type TacticStrategy = 'no-play-actions' | 'pick-heavy' | 'conservative' | 'movement-focused'
export type StrategyKind = 'random' | 'aggressive' | 'defensive' | 'learning'

export const SETUP_STRATEGIES: SetupStrategy[] = ['wide-spread', 'clustered-narrow', 'front-loaded', 'balanced']
export const OPENING_STRATEGIES: OpeningStrategy[] = ['early-pick', 'rush', 'hold', 'mixed-opening']
export const TACTIC_STRATEGIES: TacticStrategy[] = ['no-play-actions', 'pick-heavy', 'conservative', 'movement-focused']
export const STRATEGY_KINDS: StrategyKind[] = ['random', 'aggressive', 'defensive', 'learning']

export interface StrategyDetail {
  setup: SetupStrategy
  opening: OpeningStrategy
  tactic: TacticStrategy
}

export interface AgentConfig {
  name: string
  strategy: StrategyKind | StrategyDetail
  learnedWeights?: LearnedWeights
  weightsFile?: string
}

export function formatStrategy(strategy: StrategyKind | StrategyDetail): string {
  if (typeof strategy === 'string') return strategy
  return `${strategy.setup}/${strategy.opening}/${strategy.tactic}`
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

type MoveOption = { pieceId: string; targetSpotId: string }
type PickOption = { pieceId: string; targetPieceId: string }

function isForwardMove(move: MoveOption, state: GameState, player: Player): boolean {
  const spot = SPOT_BY_ID.get(move.targetSpotId)
  if (!spot) return false
  const piece = state.pieces.find((p) => p.id === move.pieceId)
  if (!piece) return false
  const origin = SPOT_BY_ID.get(piece.spotId)
  if (!origin) return false
  return player === 'P1' ? spot.y < origin.y : spot.y > origin.y
}

function getForwardMoves(allMoves: MoveOption[], state: GameState, player: Player): MoveOption[] {
  return allMoves.filter((m) => isForwardMove(m, state, player))
}

function getNonForwardMoves(allMoves: MoveOption[], state: GameState, player: Player): MoveOption[] {
  return allMoves.filter((m) => !isForwardMove(m, state, player))
}

function getBestForwardMove(forwardMoves: MoveOption[], player: Player): MoveOption {
  const goalY = player === 'P1' ? P1_GOAL_Y : P2_GOAL_Y
  return forwardMoves.reduce((best, move) => {
    const bestSpot = SPOT_BY_ID.get(best.targetSpotId)!
    const moveSpot = SPOT_BY_ID.get(move.targetSpotId)!
    return Math.abs(moveSpot.y - goalY) < Math.abs(bestSpot.y - goalY) ? move : best
  })
}

function collectActions(state: GameState, player: Player) {
  const occupancy = buildOccupancyMap(state.pieces)
  const blockedPickPointIds = new Set(state.pickPointIds)
  const ownPieces = state.pieces.filter(
    (p) => p.owner === player && !p.locked && !state.actedPieceIds.includes(p.id),
  )

  const allMoves: MoveOption[] = []
  const allPicks: PickOption[] = []

  for (const piece of ownPieces) {
    const moveTargets = computeValidMoveTargets({
      phase: state.phase, actionMode: 'move', actionsUsed: state.actionsUsed,
      turn: state.turn, selectedPiece: piece, actedPieceIds: state.actedPieceIds,
      pieces: state.pieces, occupancy, blockedPickPointIds,
    })
    for (const targetSpotId of moveTargets) {
      allMoves.push({ pieceId: piece.id, targetSpotId })
    }

    const pickTargets = computeValidPickTargets({
      phase: state.phase, actionMode: 'pick', turn: state.turn,
      selectedPiece: piece, actedPieceIds: state.actedPieceIds,
      pieces: state.pieces, occupancy, blockedPickPointIds,
    })
    for (const targetPieceId of pickTargets) {
      allPicks.push({ pieceId: piece.id, targetPieceId })
    }
  }

  return { allMoves, allPicks, ownPieces }
}

// ---- Setup strategies ----

function spreadScore(spots: Spot[]): number {
  if (spots.length === 0) return 0
  const xs = spots.map((s) => s.x)
  const ys = spots.map((s) => s.y)
  return (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys))
}

function pickSetupSpot(
  validSpots: Spot[],
  ownPieces: GameState['pieces'],
  strategy: SetupStrategy,
): Spot {
  if (strategy === 'balanced' || validSpots.length <= 1) {
    return pickRandom(validSpots)
  }

  const ownSpots = ownPieces
    .map((p) => SPOT_BY_ID.get(p.spotId))
    .filter((s): s is Spot => s != null)

  if (strategy === 'wide-spread') {
    return validSpots.reduce((best, spot) => {
      const bestScore = spreadScore([...ownSpots, best])
      const spotScore = spreadScore([...ownSpots, spot])
      return spotScore > bestScore ? spot : best
    })
  }

  if (strategy === 'clustered-narrow') {
    const centroidX = ownSpots.length > 0
      ? ownSpots.reduce((sum, s) => sum + s.x, 0) / ownSpots.length
      : LATTICE_MAX / 2
    return validSpots.reduce((best, spot) => {
      return Math.abs(spot.x - centroidX) < Math.abs(best.x - centroidX) ? spot : best
    })
  }

  if (strategy === 'front-loaded') {
    return validSpots.reduce((best, spot) => {
      return Math.abs(spot.y - MIDPOINT_Y) < Math.abs(best.y - MIDPOINT_Y) ? spot : best
    })
  }

  return pickRandom(validSpots)
}

function getSetupAction(state: GameState, player: Player, setupStrategy: SetupStrategy = 'balanced'): GameAction | null {
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
    const chosen = pickSetupSpot(validSpots, ownPieces, setupStrategy)
    return { type: 'PLACE_PIECE', pieceType: shape as PieceType, spotId: chosen.id }
  }

  return null
}

// ---- Opening strategies ----

function getOpeningAction(
  state: GameState,
  player: Player,
  strategy: OpeningStrategy,
  allMoves: MoveOption[],
  allPicks: PickOption[],
): GameAction {
  if (allMoves.length === 0 && allPicks.length === 0) {
    return { type: 'END_TURN' }
  }

  if (strategy === 'early-pick') {
    if (allPicks.length > 0) {
      const pick = pickRandom(allPicks)
      return { type: 'PICK_PIECE', pieceId: pick.pieceId, targetPieceId: pick.targetPieceId }
    }
    const move = pickRandom(allMoves)
    return { type: 'MOVE_TO_SPOT', pieceId: move.pieceId, targetSpotId: move.targetSpotId }
  }

  if (strategy === 'rush') {
    const forward = getForwardMoves(allMoves, state, player)
    if (forward.length > 0) {
      const best = getBestForwardMove(forward, player)
      return { type: 'MOVE_TO_SPOT', pieceId: best.pieceId, targetSpotId: best.targetSpotId }
    }
    if (allMoves.length > 0) {
      const move = pickRandom(allMoves)
      return { type: 'MOVE_TO_SPOT', pieceId: move.pieceId, targetSpotId: move.targetSpotId }
    }
    return { type: 'END_TURN' }
  }

  if (strategy === 'hold') {
    const nonForward = getNonForwardMoves(allMoves, state, player)
    if (nonForward.length > 0) {
      const move = pickRandom(nonForward)
      return { type: 'MOVE_TO_SPOT', pieceId: move.pieceId, targetSpotId: move.targetSpotId }
    }
    if (allMoves.length > 0) {
      const move = pickRandom(allMoves)
      return { type: 'MOVE_TO_SPOT', pieceId: move.pieceId, targetSpotId: move.targetSpotId }
    }
    return { type: 'END_TURN' }
  }

  // mixed-opening: random from all
  const allActions: GameAction[] = [
    ...allMoves.map((m) => ({ type: 'MOVE_TO_SPOT' as const, pieceId: m.pieceId, targetSpotId: m.targetSpotId })),
    ...allPicks.map((p) => ({ type: 'PICK_PIECE' as const, pieceId: p.pieceId, targetPieceId: p.targetPieceId })),
  ]
  return pickRandom(allActions)
}

// ---- Tactic strategies ----

function getTacticAction(
  state: GameState,
  player: Player,
  strategy: TacticStrategy,
  allMoves: MoveOption[],
  allPicks: PickOption[],
): GameAction {
  if (allMoves.length === 0 && allPicks.length === 0) {
    return { type: 'END_TURN' }
  }

  if (strategy === 'no-play-actions') {
    return { type: 'END_TURN' }
  }

  if (strategy === 'pick-heavy') {
    if (allPicks.length > 0) {
      const pick = pickRandom(allPicks)
      return { type: 'PICK_PIECE', pieceId: pick.pieceId, targetPieceId: pick.targetPieceId }
    }
    const forward = getForwardMoves(allMoves, state, player)
    if (forward.length > 0) {
      const best = getBestForwardMove(forward, player)
      return { type: 'MOVE_TO_SPOT', pieceId: best.pieceId, targetSpotId: best.targetSpotId }
    }
    const move = pickRandom(allMoves)
    return { type: 'MOVE_TO_SPOT', pieceId: move.pieceId, targetSpotId: move.targetSpotId }
  }

  if (strategy === 'conservative') {
    if (state.actionsUsed >= 1 && Math.random() < 0.4) {
      return { type: 'END_TURN' }
    }
    const nonForward = getNonForwardMoves(allMoves, state, player)
    if (nonForward.length > 0) {
      const move = pickRandom(nonForward)
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

  // movement-focused
  const forward = getForwardMoves(allMoves, state, player)
  if (forward.length > 0) {
    const move = pickRandom(forward)
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

// ---- Play action routing ----

function getPlayActionDetailed(
  state: GameState,
  player: Player,
  detail: StrategyDetail,
): GameAction | null {
  const { allMoves, allPicks, ownPieces } = collectActions(state, player)

  if (ownPieces.length === 0) {
    return { type: 'END_TURN' }
  }

  const isOpening = state.pieces.length >= INITIAL_PIECE_COUNT
  if (isOpening) {
    return getOpeningAction(state, player, detail.opening, allMoves, allPicks)
  }
  return getTacticAction(state, player, detail.tactic, allMoves, allPicks)
}

function getPlayActionLegacy(state: GameState, player: Player, strategy: StrategyKind): GameAction | null {
  const { allMoves, allPicks, ownPieces } = collectActions(state, player)

  if (ownPieces.length === 0) {
    return { type: 'END_TURN' }
  }

  if (allMoves.length === 0 && allPicks.length === 0) {
    return { type: 'END_TURN' }
  }

  if (strategy === 'aggressive') {
    if (allPicks.length > 0) {
      const pick = pickRandom(allPicks)
      return { type: 'PICK_PIECE', pieceId: pick.pieceId, targetPieceId: pick.targetPieceId }
    }

    const forwardMoves = getForwardMoves(allMoves, state, player)

    if (forwardMoves.length > 0) {
      const bestForward = getBestForwardMove(forwardMoves, player)
      return { type: 'MOVE_TO_SPOT', pieceId: bestForward.pieceId, targetSpotId: bestForward.targetSpotId }
    }

    const move = pickRandom(allMoves)
    return { type: 'MOVE_TO_SPOT', pieceId: move.pieceId, targetSpotId: move.targetSpotId }
  }

  if (strategy === 'defensive') {
    const forwardMoves = getForwardMoves(allMoves, state, player)

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

// ---- Main entry point ----

export function chooseAction(state: GameState, player: Player, config: AgentConfig): GameAction | null {
  if (state.phase === 'finished') {
    return null
  }

  if (typeof config.strategy === 'object') {
    if (state.phase === 'setup') {
      return getSetupAction(state, player, config.strategy.setup)
    }
    return getPlayActionDetailed(state, player, config.strategy)
  }

  if (config.strategy === 'learning') {
    if (config.learnedWeights == null) {
      throw new Error('learning strategy requires learnedWeights on AgentConfig')
    }
    const detail = pickStrategy(config.learnedWeights)
    if (state.phase === 'setup') {
      return getSetupAction(state, player, detail.setup)
    }
    return getPlayActionDetailed(state, player, detail)
  }

  if (state.phase === 'setup') {
    return getSetupAction(state, player)
  }

  if (state.phase === 'play') {
    return getPlayActionLegacy(state, player, config.strategy)
  }

  return null
}
