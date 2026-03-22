import * as fs from 'node:fs'
import * as path from 'node:path'
import { createInitialGameState, applyGameAction } from '../game/engine'
import type { GameState } from '../game/engine'
import type { Player } from '../game/types'
import { chooseAction } from './agent'
import type { AgentConfig, StrategyDetail } from './agent'
import { createGameLog, recordMove, finalizeLog } from './logger'
import type { GameLog } from './logger'
import {
  loadOrCreateWeights,
  saveWeights,
  pickStrategy,
  reinforceWin,
  reinforceLoss,
  formatWeightsReport,
} from './learning'
import type { LearnedWeights } from './learning'

export interface LearningTrainOptions {
  numGames: number
  maxTurns: number
  weightsPath: string
  outputDir: string
}

const DEFAULT_NUM_GAMES = 50
const DEFAULT_MAX_TURNS = 500
const DEFAULT_WEIGHTS_DIR = path.resolve(import.meta.dirname, '..', '..', 'ai-learning-data')
const DEFAULT_WEIGHTS_PATH = path.join(DEFAULT_WEIGHTS_DIR, 'weights.json')
const DEFAULT_OUTPUT_DIR = path.resolve(import.meta.dirname, '..', '..', 'ai-output', 'learning')

interface GameResult {
  log: GameLog
  p1Strategy: StrategyDetail
  p2Strategy: StrategyDetail
}

function playLearningGame(
  gameId: number,
  weights: LearnedWeights,
  maxTurns: number,
): GameResult {
  const p1Strategy = pickStrategy(weights)
  const p2Strategy = pickStrategy(weights)

  const p1Config: AgentConfig = { name: 'Learning-P1', strategy: p1Strategy }
  const p2Config: AgentConfig = { name: 'Learning-P2', strategy: p2Strategy }

  let state: GameState = createInitialGameState()
  const log = createGameLog(gameId, p1Config.name, p2Config.name)
  let moveCount = 0

  let consecutiveRejections = 0
  const MAX_CONSECUTIVE_REJECTIONS = 10

  while (state.phase !== 'finished' && moveCount < maxTurns) {
    const currentPlayer: Player = state.phase === 'setup' ? state.setupPlayer : state.turn
    const config = currentPlayer === 'P1' ? p1Config : p2Config
    const action = chooseAction(state, currentPlayer, config)

    if (action == null) {
      break
    }

    const result = applyGameAction(state, currentPlayer, action)

    if (!result.accepted) {
      consecutiveRejections += 1
      if (consecutiveRejections >= MAX_CONSECUTIVE_REJECTIONS) {
        break
      }
      continue
    }

    consecutiveRejections = 0
    recordMove(log, currentPlayer, action, result.state)
    state = result.state
    moveCount += 1
  }

  finalizeLog(log, state.winner)

  return { log, p1Strategy, p2Strategy }
}

function readPositiveIntegerFromEnv(
  envValue: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (envValue == null) {
    return fallback
  }

  const parsed = parseInt(envValue, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`)
  }

  return parsed
}

function main(): void {
  const NUM_GAMES = readPositiveIntegerFromEnv(process.env.NUM_GAMES, DEFAULT_NUM_GAMES, 'NUM_GAMES')
  const MAX_TURNS = readPositiveIntegerFromEnv(process.env.MAX_TURNS, DEFAULT_MAX_TURNS, 'MAX_TURNS')
  const WEIGHTS_PATH = process.env.WEIGHTS_PATH ?? DEFAULT_WEIGHTS_PATH
  const OUTPUT_DIR = process.env.OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR

  const weightsDir = path.dirname(WEIGHTS_PATH)
  fs.mkdirSync(weightsDir, { recursive: true })
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const weights = loadOrCreateWeights(WEIGHTS_PATH)
  const startGamesPlayed = weights.gamesPlayed

  console.log('=== Edgebound Learning AI Training ===')
  console.log(`Games to play: ${NUM_GAMES}`)
  console.log(`Max turns per game: ${MAX_TURNS}`)
  console.log(`Weights file: ${WEIGHTS_PATH}`)
  console.log(`Output directory: ${OUTPUT_DIR}`)
  console.log(`Resuming from game ${startGamesPlayed + 1}`)
  console.log('')

  let p1Wins = 0
  let p2Wins = 0
  let draws = 0
  let totalMoves = 0

  for (let i = 0; i < NUM_GAMES; i += 1) {
    const gameNum = startGamesPlayed + i + 1
    const result = playLearningGame(gameNum, weights, MAX_TURNS)

    if (result.log.winner === 'P1') {
      p1Wins += 1
      reinforceWin(weights, result.p1Strategy)
      reinforceLoss(weights, result.p2Strategy)
    } else if (result.log.winner === 'P2') {
      p2Wins += 1
      reinforceWin(weights, result.p2Strategy)
      reinforceLoss(weights, result.p1Strategy)
    } else {
      draws += 1
    }

    weights.gamesPlayed += 1
    totalMoves += result.log.totalMoves

    if ((i + 1) % 10 === 0 || i === NUM_GAMES - 1) {
      console.log(`  Game ${gameNum}: winner=${result.log.winner ?? 'draw'}, moves=${result.log.totalMoves}`)
      saveWeights(WEIGHTS_PATH, weights)
    }
  }

  saveWeights(WEIGHTS_PATH, weights)

  const avgMoves = NUM_GAMES > 0 ? totalMoves / NUM_GAMES : 0

  console.log('')
  console.log('=== Training Session Results ===')
  console.log(`  Games played this session: ${NUM_GAMES}`)
  console.log(`  Total games played all-time: ${weights.gamesPlayed}`)
  console.log(`  P1 Wins: ${p1Wins} (${((p1Wins / NUM_GAMES) * 100).toFixed(1)}%)`)
  console.log(`  P2 Wins: ${p2Wins} (${((p2Wins / NUM_GAMES) * 100).toFixed(1)}%)`)
  console.log(`  Draws: ${draws} (${((draws / NUM_GAMES) * 100).toFixed(1)}%)`)
  console.log(`  Average game length: ${avgMoves.toFixed(1)} moves`)
  console.log('')

  fs.writeFileSync(path.join(OUTPUT_DIR, 'weights-report.md'), formatWeightsReport(weights))

  const sessionReport: string[] = []
  sessionReport.push('# Learning AI Training Session')
  sessionReport.push('')
  sessionReport.push(`> Generated: ${new Date().toISOString()}`)
  sessionReport.push(`> Session games: ${NUM_GAMES}`)
  sessionReport.push(`> All-time games: ${weights.gamesPlayed}`)
  sessionReport.push('')
  sessionReport.push('## Session Results')
  sessionReport.push('')
  sessionReport.push('| Metric | Value |')
  sessionReport.push('|--------|-------|')
  sessionReport.push(`| Games Played | ${NUM_GAMES} |`)
  sessionReport.push(`| P1 Win Rate | ${((p1Wins / NUM_GAMES) * 100).toFixed(1)}% |`)
  sessionReport.push(`| P2 Win Rate | ${((p2Wins / NUM_GAMES) * 100).toFixed(1)}% |`)
  sessionReport.push(`| Draw Rate | ${((draws / NUM_GAMES) * 100).toFixed(1)}% |`)
  sessionReport.push(`| Avg Game Length | ${avgMoves.toFixed(1)} moves |`)
  sessionReport.push('')

  fs.writeFileSync(path.join(OUTPUT_DIR, 'session-report.md'), sessionReport.join('\n'))

  console.log('=== Training Complete ===')
  console.log(`Weights saved to: ${WEIGHTS_PATH}`)
  console.log(`Reports written to: ${OUTPUT_DIR}`)
}

main()
