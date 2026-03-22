import type { SelfPlayResult } from './selfplay'
import type { GameLog } from './logger'
import type { Player, PieceType } from '../game/types'
import { SPOT_BY_ID } from '../game/board'
import { LATTICE_MAX } from '../game/constants'

const MIDPOINT_Y = LATTICE_MAX / 2
const PICK_HEAVY_THRESHOLD = 0.3
const CONSERVATIVE_THRESHOLD = 0.3

interface SetupPattern {
  description: string
  frequency: number
  winRate: number
}

interface TacticPattern {
  description: string
  frequency: number
  winRate: number
}

interface OpeningPattern {
  description: string
  frequency: number
  winRate: number
}

interface AnalysisReport {
  solvabilityAssessment: string
  firstPlayerAdvantage: string
  drawRate: string
  avgGameLength: string
  setupPatterns: SetupPattern[]
  openingPatterns: OpeningPattern[]
  tacticPatterns: TacticPattern[]
  ruleChangeRecommendations: string[]
}

function analyzeSetupPatterns(logs: GameLog[]): SetupPattern[] {
  const patterns = new Map<string, { wins: number; total: number }>()

  for (const log of logs) {
    for (const player of ['P1', 'P2'] as Player[]) {
      const setupMoves = log.moves.filter(
        (m) => m.player === player && m.action.type === 'PLACE_PIECE',
      )

      const spreadY = new Set<number>()
      const spreadX = new Set<number>()
      for (const m of setupMoves) {
        if (m.action.type === 'PLACE_PIECE') {
          const spot = SPOT_BY_ID.get(m.action.spotId)
          if (spot) {
            spreadY.add(spot.y)
            spreadX.add(spot.x)
          }
        }
      }

      const ySpread = spreadY.size
      const xSpread = spreadX.size
      let patternName: string

      if (xSpread >= 6 && ySpread >= 3) {
        patternName = 'wide-spread'
      } else if (xSpread <= 3) {
        patternName = 'clustered-narrow'
      } else if (ySpread <= 2) {
        patternName = 'front-loaded'
      } else {
        patternName = 'balanced'
      }

      const key = `${player}-${patternName}`
      const entry = patterns.get(key) ?? { wins: 0, total: 0 }
      entry.total += 1
      if (log.winner === player) {
        entry.wins += 1
      }
      patterns.set(key, entry)
    }
  }

  return Array.from(patterns.entries()).map(([key, data]) => ({
    description: key,
    frequency: data.total,
    winRate: data.total > 0 ? data.wins / data.total : 0,
  }))
}

function analyzeOpeningPatterns(logs: GameLog[]): OpeningPattern[] {
  const patterns = new Map<string, { wins: number; total: number }>()

  for (const log of logs) {
    const playMoves = log.moves.filter((m) => m.resultState.phase === 'play')
    const first4 = playMoves.slice(0, 8)

    if (first4.length === 0) continue

    for (const player of ['P1', 'P2'] as Player[]) {
      const playerMoves = first4.filter((m) => m.player === player)
      const moveTypes = playerMoves.map((m) => m.action.type)

      const hasPick = moveTypes.includes('PICK_PIECE')

      let direction = 'mixed'
      const advances = playerMoves.filter((m) => {
        if (m.action.type !== 'MOVE_TO_SPOT') return false
        const spot = SPOT_BY_ID.get(m.action.targetSpotId)
        if (!spot) return false
        return player === 'P1' ? spot.y <= MIDPOINT_Y : spot.y >= MIDPOINT_Y
      })

      if (advances.length === playerMoves.length && playerMoves.length > 0) {
        direction = 'aggressive-rush'
      } else if (advances.length === 0 && playerMoves.length > 0) {
        direction = 'defensive-hold'
      }

      let patternName: string
      if (hasPick) {
        patternName = 'early-pick'
      } else if (direction === 'aggressive-rush') {
        patternName = 'rush'
      } else if (direction === 'defensive-hold') {
        patternName = 'hold'
      } else {
        patternName = 'mixed-opening'
      }

      const key = `${player}-${patternName}`
      const entry = patterns.get(key) ?? { wins: 0, total: 0 }
      entry.total += 1
      if (log.winner === player) {
        entry.wins += 1
      }
      patterns.set(key, entry)
    }
  }

  return Array.from(patterns.entries()).map(([key, data]) => ({
    description: key,
    frequency: data.total,
    winRate: data.total > 0 ? data.wins / data.total : 0,
  }))
}

function analyzeTactics(logs: GameLog[]): TacticPattern[] {
  const patterns = new Map<string, { wins: number; total: number }>()

  for (const log of logs) {
    for (const player of ['P1', 'P2'] as Player[]) {
      const playerMoves = log.moves.filter(
        (m) => m.player === player && m.resultState.phase === 'play',
      )

      const picks = playerMoves.filter((m) => m.action.type === 'PICK_PIECE')
      const moves = playerMoves.filter((m) => m.action.type === 'MOVE_TO_SPOT')
      const endTurns = playerMoves.filter((m) => m.action.type === 'END_TURN')

      let primaryTactic: string
      if (playerMoves.length === 0) {
        primaryTactic = 'no-play-actions'
      } else if (picks.length > moves.length * PICK_HEAVY_THRESHOLD) {
        primaryTactic = 'pick-heavy'
      } else if (endTurns.length > playerMoves.length * CONSERVATIVE_THRESHOLD) {
        primaryTactic = 'conservative'
      } else {
        primaryTactic = 'movement-focused'
      }

      let maxProgress = 0
      for (const m of moves) {
        if (m.action.type === 'MOVE_TO_SPOT') {
          const spot = SPOT_BY_ID.get(m.action.targetSpotId)
          if (spot) {
            const progress = player === 'P1'
              ? (LATTICE_MAX - spot.y) / LATTICE_MAX
              : spot.y / LATTICE_MAX
            maxProgress = Math.max(maxProgress, progress)
          }
        }
      }

      const pieceTypesUsed = new Set<PieceType>()
      for (const m of playerMoves) {
        if (m.action.type === 'MOVE_TO_SPOT' || m.action.type === 'PICK_PIECE') {
          const pieceId = (m.action as { pieceId: string }).pieceId
          const piece = m.resultState.pieces.find((p) => p.id === pieceId)
          if (piece) pieceTypesUsed.add(piece.type)
        }
      }

      const key = `${player}-${primaryTactic}`
      const entry = patterns.get(key) ?? { wins: 0, total: 0 }
      entry.total += 1
      if (log.winner === player) {
        entry.wins += 1
      }
      patterns.set(key, entry)
    }
  }

  return Array.from(patterns.entries()).map(([key, data]) => ({
    description: key,
    frequency: data.total,
    winRate: data.total > 0 ? data.wins / data.total : 0,
  }))
}

export function analyzeResults(result: SelfPlayResult): AnalysisReport {
  const { logs, p1Wins, p2Wins, draws, totalGames, avgMoves } = result

  const p1WinRate = totalGames > 0 ? p1Wins / totalGames : 0
  const p2WinRate = totalGames > 0 ? p2Wins / totalGames : 0
  const drawRate = totalGames > 0 ? draws / totalGames : 0

  let firstPlayerAdvantage: string
  const advantageDiff = Math.abs(p1WinRate - p2WinRate)
  if (advantageDiff < 0.05) {
    firstPlayerAdvantage = 'No significant first-player advantage detected. The game appears balanced.'
  } else if (p1WinRate > p2WinRate) {
    firstPlayerAdvantage = `P1 (first player) has a ${(advantageDiff * 100).toFixed(1)}% win rate advantage. ` +
      (advantageDiff > 0.2
        ? 'This is a significant advantage that may indicate structural imbalance.'
        : 'This is a moderate advantage, possibly due to tempo.')
  } else {
    firstPlayerAdvantage = `P2 (second player) has a ${(advantageDiff * 100).toFixed(1)}% win rate advantage. ` +
      'This is unusual and may indicate the second player gains a strategic benefit from observing P1\'s setup.'
  }

  let solvabilityAssessment: string
  if (drawRate > 0.5) {
    solvabilityAssessment = 'High draw rate suggests the game may tend toward stalemates. ' +
      'This could indicate the game is partially solvable with optimal defensive play.'
  } else if (drawRate > 0.3) {
    solvabilityAssessment = 'Moderate draw rate. The game has enough complexity to produce decisive outcomes ' +
      'but draws occur frequently enough to suggest forced-draw strategies may exist.'
  } else if (avgMoves < 50) {
    solvabilityAssessment = 'Low draw rate with short games. The game resolves quickly, ' +
      'which could mean aggressive strategies dominate or the game lacks defensive depth.'
  } else {
    solvabilityAssessment = 'Low draw rate with substantial game length. ' +
      'The game appears to have good strategic depth and is unlikely to be easily solvable.'
  }

  const ruleChangeRecommendations: string[] = []

  if (advantageDiff > 0.15) {
    ruleChangeRecommendations.push(
      `The ${p1WinRate > p2WinRate ? 'first' : 'second'} player has a significant advantage. ` +
      'Consider: (1) giving the disadvantaged player an extra action on their first turn, ' +
      '(2) allowing the second player to place setup pieces first, or ' +
      '(3) using a "pie rule" where P2 can choose to swap sides after P1\'s first move.',
    )
  }

  if (drawRate > 0.4) {
    ruleChangeRecommendations.push(
      'High draw rate detected. Consider: (1) reducing the number of pieces to make the board less congested, ' +
      '(2) limiting the number of picks allowed per game, ' +
      '(3) adding a move limit after which the player with the most forward progress wins, or ' +
      '(4) reducing the board size to force more confrontation.',
    )
  }

  if (avgMoves > 300) {
    ruleChangeRecommendations.push(
      'Games are very long on average. Consider: (1) increasing the number of actions per turn, ' +
      '(2) increasing piece movement ranges, or ' +
      '(3) adding a turn limit with a tiebreaker rule (e.g., most forward piece wins).',
    )
  }

  if (avgMoves < 30 && drawRate < 0.1) {
    ruleChangeRecommendations.push(
      'Games end very quickly with few draws. The game may lack defensive options. Consider: ' +
      '(1) adding a mandatory minimum distance from the goal line during early turns, ' +
      '(2) requiring pieces to survive at least N turns before being able to win, or ' +
      '(3) giving the defending player reactive abilities.',
    )
  }

  if (ruleChangeRecommendations.length === 0) {
    ruleChangeRecommendations.push(
      'No critical rule changes needed based on current analysis. ' +
      'The game appears reasonably balanced. Continue monitoring with more games for higher confidence.',
    )
  }

  return {
    solvabilityAssessment,
    firstPlayerAdvantage,
    drawRate: `${(drawRate * 100).toFixed(1)}%`,
    avgGameLength: `${avgMoves.toFixed(1)} moves`,
    setupPatterns: analyzeSetupPatterns(logs),
    openingPatterns: analyzeOpeningPatterns(logs),
    tacticPatterns: analyzeTactics(logs),
    ruleChangeRecommendations,
  }
}

export function formatAnalysisReport(report: AnalysisReport): string {
  const lines: string[] = []

  lines.push('# Game Analysis Report')
  lines.push('')

  lines.push('## Solvability Assessment')
  lines.push('')
  lines.push(report.solvabilityAssessment)
  lines.push('')

  lines.push('## First-Player Advantage')
  lines.push('')
  lines.push(report.firstPlayerAdvantage)
  lines.push('')

  lines.push('## Key Statistics')
  lines.push('')
  lines.push(`- **Draw Rate**: ${report.drawRate}`)
  lines.push(`- **Average Game Length**: ${report.avgGameLength}`)
  lines.push('')

  lines.push('## Board Setup Patterns')
  lines.push('')
  lines.push('| Pattern | Frequency | Win Rate |')
  lines.push('|---------|-----------|----------|')
  for (const p of report.setupPatterns.sort((a, b) => b.frequency - a.frequency)) {
    lines.push(`| ${p.description} | ${p.frequency} | ${(p.winRate * 100).toFixed(1)}% |`)
  }
  lines.push('')

  lines.push('## Opening Move Patterns')
  lines.push('')
  lines.push('| Pattern | Frequency | Win Rate |')
  lines.push('|---------|-----------|----------|')
  for (const p of report.openingPatterns.sort((a, b) => b.frequency - a.frequency)) {
    lines.push(`| ${p.description} | ${p.frequency} | ${(p.winRate * 100).toFixed(1)}% |`)
  }
  lines.push('')

  lines.push('## Tactical Patterns')
  lines.push('')
  lines.push('| Pattern | Frequency | Win Rate |')
  lines.push('|---------|-----------|----------|')
  for (const p of report.tacticPatterns.sort((a, b) => b.frequency - a.frequency)) {
    lines.push(`| ${p.description} | ${p.frequency} | ${(p.winRate * 100).toFixed(1)}% |`)
  }
  lines.push('')

  lines.push('## Rule Change Recommendations')
  lines.push('')
  for (let i = 0; i < report.ruleChangeRecommendations.length; i += 1) {
    lines.push(`${i + 1}. ${report.ruleChangeRecommendations[i]}`)
  }
  lines.push('')

  return lines.join('\n')
}
