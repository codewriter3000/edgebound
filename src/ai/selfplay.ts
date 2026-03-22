import { createInitialGameState, applyGameAction } from '../game/engine'
import type { GameState } from '../game/engine'
import type { Player } from '../game/types'
import { chooseAction } from './agent'
import type { AgentConfig } from './agent'
import { createGameLog, recordMove, finalizeLog, formatGameLog } from './logger'
import type { GameLog } from './logger'

export interface SelfPlayOptions {
  p1: AgentConfig
  p2: AgentConfig
  numGames: number
  maxTurns: number
}

export interface SelfPlayResult {
  logs: GameLog[]
  p1Wins: number
  p2Wins: number
  draws: number
  totalGames: number
  avgMoves: number
}

const DEFAULT_MAX_TURNS = 500

export function playSingleGame(
  gameId: number,
  p1Config: AgentConfig,
  p2Config: AgentConfig,
  maxTurns: number = DEFAULT_MAX_TURNS,
): GameLog {
  let state: GameState = createInitialGameState()
  const log = createGameLog(gameId, p1Config.name, p2Config.name)
  let moveCount = 0

  while (state.phase !== 'finished' && moveCount < maxTurns) {
    const currentPlayer: Player = state.phase === 'setup' ? state.setupPlayer : state.turn
    const config = currentPlayer === 'P1' ? p1Config : p2Config
    const action = chooseAction(state, currentPlayer, config)

    if (action == null) {
      break
    }

    const result = applyGameAction(state, currentPlayer, action)

    if (!result.accepted) {
      continue
    }

    recordMove(log, currentPlayer, action, result.state)
    state = result.state
    moveCount += 1
  }

  finalizeLog(log, state.winner)
  return log
}

export function runSelfPlay(options: SelfPlayOptions): SelfPlayResult {
  const { p1, p2, numGames, maxTurns } = options
  const logs: GameLog[] = []
  let p1Wins = 0
  let p2Wins = 0
  let draws = 0
  let totalMoves = 0

  for (let i = 0; i < numGames; i += 1) {
    const log = playSingleGame(i + 1, p1, p2, maxTurns)
    logs.push(log)

    if (log.winner === 'P1') {
      p1Wins += 1
    } else if (log.winner === 'P2') {
      p2Wins += 1
    } else {
      draws += 1
    }

    totalMoves += log.totalMoves
  }

  return {
    logs,
    p1Wins,
    p2Wins,
    draws,
    totalGames: numGames,
    avgMoves: numGames > 0 ? totalMoves / numGames : 0,
  }
}

export function formatSelfPlayResults(result: SelfPlayResult): string {
  const lines: string[] = []
  lines.push('# Self-Play Session Results')
  lines.push('')
  lines.push(`- **Total Games**: ${result.totalGames}`)
  lines.push(`- **P1 Wins**: ${result.p1Wins} (${((result.p1Wins / result.totalGames) * 100).toFixed(1)}%)`)
  lines.push(`- **P2 Wins**: ${result.p2Wins} (${((result.p2Wins / result.totalGames) * 100).toFixed(1)}%)`)
  lines.push(`- **Draws/Stalemates**: ${result.draws} (${((result.draws / result.totalGames) * 100).toFixed(1)}%)`)
  lines.push(`- **Average Moves per Game**: ${result.avgMoves.toFixed(1)}`)
  lines.push('')
  return lines.join('\n')
}

export function formatAllGameLogs(result: SelfPlayResult): string {
  const sections: string[] = []
  sections.push('# Complete Game Logs')
  sections.push('')

  for (const log of result.logs) {
    sections.push(formatGameLog(log))
    sections.push('---')
    sections.push('')
  }

  return sections.join('\n')
}
