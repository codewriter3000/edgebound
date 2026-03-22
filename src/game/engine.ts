import {
  LATTICE_MAX,
  MAX_MOVES_PER_TURN,
  PIECE_LIMITS,
  SHAPES,
} from './constants'
import { SPOT_BY_ID } from './board'
import {
  buildOccupancyMap,
  computeValidMoveTargets,
  computeValidPickTargets,
} from './movement'
import {
  canPlaceInSetup,
  hasRequiredSetupSpacing,
  otherPlayer,
} from './rules'
import type { Phase, Piece, PieceType, Player } from './types'

export interface GameState {
  phase: Phase
  pieces: Piece[]
  setupPlayer: Player
  turn: Player
  winner: Player | null
  actionsUsed: number
  actedPieceIds: string[]
  pickPointIds: string[]
}

export type GameAction =
  | {
      type: 'PLACE_PIECE'
      pieceType: PieceType
      spotId: string
    }
  | {
      type: 'MOVE_TO_SPOT'
      pieceId: string
      targetSpotId: string
    }
  | {
      type: 'PICK_PIECE'
      pieceId: string
      targetPieceId: string
    }
  | {
      type: 'END_TURN'
    }
  | {
      type: 'RESET_GAME'
    }

export interface ApplyActionResult {
  accepted: boolean
  state: GameState
  error?: string
}

export function createInitialGameState(): GameState {
  return {
    phase: 'setup',
    pieces: [],
    setupPlayer: 'P1',
    turn: 'P1',
    winner: null,
    actionsUsed: 0,
    actedPieceIds: [],
    pickPointIds: [],
  }
}

function setupCounts(pieces: Piece[]) {
  const counts = {
    P1: { triangle: 0, square: 0, circle: 0 },
    P2: { triangle: 0, square: 0, circle: 0 },
  }

  pieces.forEach((piece) => {
    counts[piece.owner][piece.type] += 1
  })

  return counts
}

function checkWin(nextPieces: Piece[]): Player | null {
  const p1Reached = nextPieces.some((piece) => {
    if (piece.owner !== 'P1') {
      return false
    }

    const spot = SPOT_BY_ID.get(piece.spotId)
    return spot?.kind === 'square' && spot.y === 1
  })

  if (p1Reached) {
    return 'P1'
  }

  const p2Reached = nextPieces.some((piece) => {
    if (piece.owner !== 'P2') {
      return false
    }

    const spot = SPOT_BY_ID.get(piece.spotId)
    return spot?.kind === 'square' && spot.y === LATTICE_MAX - 1
  })

  if (p2Reached) {
    return 'P2'
  }

  return null
}

function registerAction(
  state: GameState,
  updatedPieces: Piece[],
  actorId: string,
  newPickPointId?: string,
): GameState {
  const maybeWinner = checkWin(updatedPieces)

  const nextPickPointIds =
    newPickPointId == null || state.pickPointIds.includes(newPickPointId)
      ? state.pickPointIds
      : [...state.pickPointIds, newPickPointId]

  if (maybeWinner != null) {
    return {
      ...state,
      phase: 'finished',
      pieces: updatedPieces,
      winner: maybeWinner,
      pickPointIds: nextPickPointIds,
    }
  }

  const nextActionsUsed = state.actionsUsed + 1
  const nextActedPieceIds = state.actedPieceIds.includes(actorId)
    ? state.actedPieceIds
    : [...state.actedPieceIds, actorId]

  if (nextActionsUsed >= MAX_MOVES_PER_TURN) {
    return {
      ...state,
      pieces: updatedPieces,
      turn: otherPlayer(state.turn),
      actionsUsed: 0,
      actedPieceIds: [],
      pickPointIds: nextPickPointIds,
    }
  }

  return {
    ...state,
    pieces: updatedPieces,
    actionsUsed: nextActionsUsed,
    actedPieceIds: nextActedPieceIds,
    pickPointIds: nextPickPointIds,
  }
}

function applySetupPlacement(
  state: GameState,
  actor: Player,
  pieceType: PieceType,
  spotId: string,
): ApplyActionResult {
  if (state.phase !== 'setup') {
    return { accepted: false, state, error: 'Setup is complete.' }
  }

  if (state.setupPlayer !== actor) {
    return { accepted: false, state, error: 'Not your setup turn.' }
  }

  const spot = SPOT_BY_ID.get(spotId)
  if (spot == null) {
    return { accepted: false, state, error: 'Unknown spot.' }
  }

  const occupancy = buildOccupancyMap(state.pieces)
  if ((occupancy.get(spot.id)?.length ?? 0) > 0 || !canPlaceInSetup(spot, state.setupPlayer)) {
    return { accepted: false, state, error: 'Invalid setup placement.' }
  }

  const ownPieces = state.pieces.filter((piece) => piece.owner === state.setupPlayer)
  if (!hasRequiredSetupSpacing(spot, ownPieces)) {
    return { accepted: false, state, error: 'Setup spacing rule violated.' }
  }

  const counts = setupCounts(state.pieces)
  const currentCount = counts[state.setupPlayer][pieceType]

  if (currentCount >= PIECE_LIMITS[pieceType]) {
    return { accepted: false, state, error: 'Piece type limit reached.' }
  }

  const newPiece: Piece = {
    id: `${state.setupPlayer}-${pieceType}-${currentCount + 1}`,
    owner: state.setupPlayer,
    type: pieceType,
    spotId: spot.id,
    locked: false,
    hasMoved: false,
  }

  const nextPieces = [...state.pieces, newPiece]

  const currentDone = SHAPES.every((shape) => {
    const value = shape === pieceType ? counts[state.setupPlayer][shape] + 1 : counts[state.setupPlayer][shape]
    return value === PIECE_LIMITS[shape]
  })

  if (!currentDone) {
    return {
      accepted: true,
      state: {
        ...state,
        pieces: nextPieces,
      },
    }
  }

  if (state.setupPlayer === 'P1') {
    return {
      accepted: true,
      state: {
        ...state,
        pieces: nextPieces,
        setupPlayer: 'P2',
      },
    }
  }

  return {
    accepted: true,
    state: {
      ...state,
      phase: 'play',
      pieces: nextPieces,
      turn: 'P1',
      actionsUsed: 0,
      actedPieceIds: [],
    },
  }
}

function applyMove(
  state: GameState,
  actor: Player,
  pieceId: string,
  targetSpotId: string,
): ApplyActionResult {
  if (state.phase !== 'play') {
    return { accepted: false, state, error: 'Game is not in play phase.' }
  }

  if (state.turn !== actor) {
    return { accepted: false, state, error: 'Not your turn.' }
  }

  const selectedPiece = state.pieces.find((piece) => piece.id === pieceId) ?? null
  if (selectedPiece == null) {
    return { accepted: false, state, error: 'Unknown piece.' }
  }

  const targetSpot = SPOT_BY_ID.get(targetSpotId)
  if (targetSpot == null) {
    return { accepted: false, state, error: 'Unknown spot.' }
  }

  const occupancy = buildOccupancyMap(state.pieces)
  const validMoveTargets = computeValidMoveTargets({
    phase: state.phase,
    actionMode: 'move',
    actionsUsed: state.actionsUsed,
    turn: state.turn,
    selectedPiece,
    actedPieceIds: state.actedPieceIds,
    pieces: state.pieces,
    occupancy,
    blockedPickPointIds: new Set(state.pickPointIds),
  })

  if (!validMoveTargets.has(targetSpot.id)) {
    return { accepted: false, state, error: 'Illegal move target.' }
  }

  const targetPieces = occupancy.get(targetSpot.id) ?? []
  const enemyAtTarget = targetPieces.find((piece) => piece.owner !== state.turn && !piece.locked)

  if (enemyAtTarget != null) {
    const updatedPieces = state.pieces.map((piece) => {
      if (piece.id === selectedPiece.id) {
        return { ...piece, spotId: targetSpot.id, locked: true, hasMoved: true }
      }

      if (piece.id === enemyAtTarget.id) {
        return { ...piece, locked: true }
      }

      return piece
    })

    return {
      accepted: true,
      state: registerAction(state, updatedPieces, selectedPiece.id, targetSpot.id),
    }
  }

  const updatedPieces = state.pieces.map((piece) =>
    piece.id === selectedPiece.id ? { ...piece, spotId: targetSpot.id, hasMoved: true } : piece,
  )

  return {
    accepted: true,
    state: registerAction(state, updatedPieces, selectedPiece.id),
  }
}

function applyPick(
  state: GameState,
  actor: Player,
  pieceId: string,
  targetPieceId: string,
): ApplyActionResult {
  if (state.phase !== 'play') {
    return { accepted: false, state, error: 'Game is not in play phase.' }
  }

  if (state.turn !== actor) {
    return { accepted: false, state, error: 'Not your turn.' }
  }

  const selectedPiece = state.pieces.find((piece) => piece.id === pieceId) ?? null
  const targetPiece = state.pieces.find((piece) => piece.id === targetPieceId) ?? null

  if (selectedPiece == null || targetPiece == null) {
    return { accepted: false, state, error: 'Unknown piece.' }
  }

  const occupancy = buildOccupancyMap(state.pieces)
  const validPickTargets = computeValidPickTargets({
    phase: state.phase,
    actionMode: 'pick',
    turn: state.turn,
    selectedPiece,
    actedPieceIds: state.actedPieceIds,
    pieces: state.pieces,
    occupancy,
    blockedPickPointIds: new Set(state.pickPointIds),
  })

  if (!validPickTargets.has(targetPiece.id)) {
    return { accepted: false, state, error: 'Illegal pick target.' }
  }

  const updatedPieces = state.pieces.map((piece) => {
    if (piece.id === selectedPiece.id) {
      return { ...piece, spotId: targetPiece.spotId, locked: true, hasMoved: true }
    }

    if (piece.id === targetPiece.id) {
      return { ...piece, locked: true }
    }

    return piece
  })

  return {
    accepted: true,
    state: registerAction(state, updatedPieces, selectedPiece.id, targetPiece.spotId),
  }
}

function applyEndTurn(state: GameState, actor: Player): ApplyActionResult {
  if (state.phase !== 'play') {
    return { accepted: false, state, error: 'Game is not in play phase.' }
  }

  if (state.turn !== actor) {
    return { accepted: false, state, error: 'Not your turn.' }
  }

  return {
    accepted: true,
    state: {
      ...state,
      turn: otherPlayer(state.turn),
      actionsUsed: 0,
      actedPieceIds: [],
    },
  }
}

export function applyGameAction(
  state: GameState,
  actor: Player,
  action: GameAction,
): ApplyActionResult {
  if (action.type === 'RESET_GAME') {
    return {
      accepted: true,
      state: createInitialGameState(),
    }
  }

  if (action.type === 'PLACE_PIECE') {
    return applySetupPlacement(state, actor, action.pieceType, action.spotId)
  }

  if (action.type === 'MOVE_TO_SPOT') {
    return applyMove(state, actor, action.pieceId, action.targetSpotId)
  }

  if (action.type === 'PICK_PIECE') {
    return applyPick(state, actor, action.pieceId, action.targetPieceId)
  }

  if (action.type === 'END_TURN') {
    return applyEndTurn(state, actor)
  }

  return {
    accepted: false,
    state,
    error: 'Unknown action type.',
  }
}
