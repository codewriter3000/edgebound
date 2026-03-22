import type { GameState, GameAction } from '../game/engine'
import type { Player, Piece } from '../game/types'
import { pieceGlyph } from '../game/rules'

export interface MoveLogEntry {
  moveNumber: number
  player: Player
  action: GameAction
  resultState: GameState
  timestamp: number
}

export interface GameLog {
  gameId: number
  p1Agent: string
  p2Agent: string
  winner: Player | null
  totalMoves: number
  moves: MoveLogEntry[]
  startTime: number
  endTime: number
}

export function createGameLog(gameId: number, p1Agent: string, p2Agent: string): GameLog {
  return {
    gameId,
    p1Agent,
    p2Agent,
    winner: null,
    totalMoves: 0,
    moves: [],
    startTime: Date.now(),
    endTime: 0,
  }
}

export function recordMove(log: GameLog, player: Player, action: GameAction, resultState: GameState): void {
  log.moves.push({
    moveNumber: log.moves.length + 1,
    player,
    action,
    resultState: { ...resultState, pieces: resultState.pieces.map((p) => ({ ...p })) },
    timestamp: Date.now(),
  })
  log.totalMoves = log.moves.length
}

export function finalizeLog(log: GameLog, winner: Player | null): void {
  log.winner = winner
  log.endTime = Date.now()
}

function describeAction(action: GameAction, pieces: Piece[]): string {
  switch (action.type) {
    case 'PLACE_PIECE':
      return `places ${action.pieceType} at ${action.spotId}`
    case 'MOVE_TO_SPOT': {
      const piece = pieces.find((p) => p.id === action.pieceId)
      const origin = piece ? piece.spotId : '?'
      return `moves ${piece ? pieceGlyph(piece.type) : '?'}(${action.pieceId}) from ${origin} to ${action.targetSpotId}`
    }
    case 'PICK_PIECE': {
      const attacker = pieces.find((p) => p.id === action.pieceId)
      const target = pieces.find((p) => p.id === action.targetPieceId)
      return `picks ${attacker ? pieceGlyph(attacker.type) : '?'}(${action.pieceId}) → ${target ? pieceGlyph(target.type) : '?'}(${action.targetPieceId})`
    }
    case 'END_TURN':
      return 'ends turn'
    case 'RESET_GAME':
      return 'resets game'
  }
}

function describeBoard(pieces: Piece[]): string {
  const activePieces = pieces.filter((p) => !p.locked)
  const lockedPieces = pieces.filter((p) => p.locked)

  const lines: string[] = []

  for (const player of ['P1', 'P2'] as Player[]) {
    const active = activePieces.filter((p) => p.owner === player)
    const locked = lockedPieces.filter((p) => p.owner === player)
    const activeStr = active
      .map((p) => `${pieceGlyph(p.type)}@${p.spotId}`)
      .join(', ')
    const lockedStr = locked.length > 0
      ? ` | locked: ${locked.map((p) => `${pieceGlyph(p.type)}@${p.spotId}`).join(', ')}`
      : ''
    lines.push(`  ${player}: ${activeStr}${lockedStr}`)
  }

  return lines.join('\n')
}

export function formatGameLog(log: GameLog): string {
  const lines: string[] = []

  lines.push(`# Game ${log.gameId} Log`)
  lines.push('')
  lines.push(`- **P1 Agent**: ${log.p1Agent}`)
  lines.push(`- **P2 Agent**: ${log.p2Agent}`)
  lines.push(`- **Winner**: ${log.winner ?? 'Draw/Stalemate'}`)
  lines.push(`- **Total Moves**: ${log.totalMoves}`)
  lines.push(`- **Duration**: ${log.endTime - log.startTime}ms`)
  lines.push('')
  lines.push('## Move-by-Move Log')
  lines.push('')

  let currentPhase = ''

  for (const entry of log.moves) {
    const phase = entry.resultState.phase
    if (phase !== currentPhase) {
      currentPhase = phase
      lines.push(`### Phase: ${phase.toUpperCase()}`)
      lines.push('')
    }

    const prevMoveIdx = log.moves.indexOf(entry) - 1
    const prevPieces = prevMoveIdx >= 0
      ? log.moves[prevMoveIdx].resultState.pieces
      : []

    const piecesForDesc = entry.action.type === 'MOVE_TO_SPOT' || entry.action.type === 'PICK_PIECE'
      ? prevPieces
      : entry.resultState.pieces

    lines.push(
      `**${entry.moveNumber}.** \`${entry.player}\` ${describeAction(entry.action, piecesForDesc)}`,
    )
  }

  lines.push('')
  lines.push('## Final Board State')
  lines.push('')
  lines.push('```')
  if (log.moves.length > 0) {
    lines.push(describeBoard(log.moves[log.moves.length - 1].resultState.pieces))
  }
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}
