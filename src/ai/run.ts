import * as fs from 'node:fs'
import * as path from 'node:path'
import { runSelfPlay, formatSelfPlayResults, formatAllGameLogs } from './selfplay'
import type { AgentConfig } from './agent'
import { formatStrategy } from './agent'
import { analyzeResults, formatAnalysisReport } from './analysis'
import { generateStrategyMarkdown } from './strategy-tracker'
import { loadAiConfig } from './config'
import { loadOrCreateWeights, saveWeights, reinforceWin, reinforceLoss, formatWeightsReport } from './learning'

const DEFAULT_NUM_GAMES = 20
const DEFAULT_MAX_TURNS = 500
const DEFAULT_OUTPUT_DIR = path.resolve(import.meta.dirname, '..', '..', 'ai-output')

const defaultMatchups: Array<{ p1: AgentConfig; p2: AgentConfig }> = [
  {
    p1: { name: 'Random-P1', strategy: 'random' },
    p2: { name: 'Random-P2', strategy: 'random' },
  },
  {
    p1: { name: 'Aggressive-P1', strategy: 'aggressive' },
    p2: { name: 'Defensive-P2', strategy: 'defensive' },
  },
  {
    p1: { name: 'Defensive-P1', strategy: 'defensive' },
    p2: { name: 'Aggressive-P2', strategy: 'aggressive' },
  },
  {
    p1: { name: 'Aggressive-P1', strategy: 'aggressive' },
    p2: { name: 'Aggressive-P2', strategy: 'aggressive' },
  },
]

function parseConfigPathFromArgs(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--config' && i + 1 < args.length) {
      return args[i + 1]
    }

    if (arg.startsWith('--config=')) {
      return arg.slice('--config='.length)
    }
  }

  // Accept a bare positional arg as the config path (npm eats --config)
  const positional = args.filter((a) => !a.startsWith('-'))
  if (positional.length > 0) {
    return positional[0]
  }

  return undefined
}

function readPositiveIntegerFromEnv(
  envValue: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (envValue == null || envValue === '') {
    return fallback
  }

  const parsed = parseInt(envValue, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`)
  }

  return parsed
}

function main(): void {
  const configPathFromArgs = parseConfigPathFromArgs(process.argv.slice(2))
  const configPath = configPathFromArgs ?? process.env.AI_CONFIG
  const loadedConfig = configPath != null ? loadAiConfig(configPath) : null

  const matchups = loadedConfig?.matchups ?? defaultMatchups
  const numGamesFallback = loadedConfig?.numGames ?? DEFAULT_NUM_GAMES
  const maxTurnsFallback = loadedConfig?.maxTurns ?? DEFAULT_MAX_TURNS

  const NUM_GAMES = readPositiveIntegerFromEnv(process.env.NUM_GAMES, numGamesFallback, 'NUM_GAMES')
  const MAX_TURNS = readPositiveIntegerFromEnv(process.env.MAX_TURNS, maxTurnsFallback, 'MAX_TURNS')
  const OUTPUT_DIR = process.env.OUTPUT_DIR
    ?? (loadedConfig?.outputDir != null
      ? path.resolve(loadedConfig.sourceDir, loadedConfig.outputDir)
      : DEFAULT_OUTPUT_DIR)

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log('=== Edgebound AI Self-Play Training ===')
  console.log(`Running ${NUM_GAMES} games per matchup, ${matchups.length} matchups`)
  console.log(`Max turns per game: ${MAX_TURNS}`)
  console.log(`Output directory: ${OUTPUT_DIR}`)
  if (loadedConfig != null) {
    console.log(`Config file: ${loadedConfig.sourcePath}`)
  }
  console.log('')

  const allStrategyLines: string[] = []
  let totalP1Wins = 0
  let totalP2Wins = 0
  let totalDraws = 0
  let totalGames = 0

  // Resolve weightsFile paths relative to config dir (or cwd) and load weights
  const configDir = loadedConfig?.sourceDir ?? process.cwd()
  for (const matchup of matchups) {
    for (const agent of [matchup.p1, matchup.p2]) {
      if (agent.strategy === 'learning' && agent.weightsFile != null) {
        const resolved = path.resolve(configDir, agent.weightsFile)
        agent.learnedWeights = loadOrCreateWeights(resolved)
        agent.weightsFile = resolved          // store absolute for saving later
      }
    }
  }

  for (let m = 0; m < matchups.length; m += 1) {
    const matchup = matchups[m]
    console.log(`--- Matchup ${m + 1}: ${matchup.p1.name} (${formatStrategy(matchup.p1.strategy)}) vs ${matchup.p2.name} (${formatStrategy(matchup.p2.strategy)}) ---`)

    const result = runSelfPlay({
      p1: matchup.p1,
      p2: matchup.p2,
      numGames: NUM_GAMES,
      maxTurns: MAX_TURNS,
    })

    // Reinforce learning agents based on game outcomes
    for (const log of result.logs) {
      for (const agent of [matchup.p1, matchup.p2]) {
        if (agent.strategy !== 'learning' || agent.learnedWeights == null) continue
        const side = agent === matchup.p1 ? 'P1' : 'P2'
        const detail = side === 'P1' ? log.p1Strategy : log.p2Strategy
        if (detail == null) continue
        if (log.winner === side) {
          reinforceWin(agent.learnedWeights, detail)
        } else if (log.winner != null) {
          reinforceLoss(agent.learnedWeights, detail)
        }
        agent.learnedWeights.gamesPlayed += 1
      }
    }

    console.log(`  P1 Wins: ${result.p1Wins}, P2 Wins: ${result.p2Wins}, Draws: ${result.draws}`)
    console.log(`  Average game length: ${result.avgMoves.toFixed(1)} moves`)
    console.log('')

    totalP1Wins += result.p1Wins
    totalP2Wins += result.p2Wins
    totalDraws += result.draws
    totalGames += result.totalGames

    const matchupDir = path.join(OUTPUT_DIR, `matchup-${m + 1}-${formatStrategy(matchup.p1.strategy)}-vs-${formatStrategy(matchup.p2.strategy)}`)
    fs.mkdirSync(matchupDir, { recursive: true })

    fs.writeFileSync(
      path.join(matchupDir, 'results.md'),
      formatSelfPlayResults(result),
    )

    fs.writeFileSync(
      path.join(matchupDir, 'game-logs.md'),
      formatAllGameLogs(result),
    )

    const report = analyzeResults(result)
    fs.writeFileSync(
      path.join(matchupDir, 'analysis.md'),
      formatAnalysisReport(report),
    )

    allStrategyLines.push(generateStrategyMarkdown(result))
  }

  const overallSummary: string[] = []
  overallSummary.push('# Edgebound AI Training - Overall Strategy Report')
  overallSummary.push('')
  overallSummary.push(`> Generated: ${new Date().toISOString()}`)
  overallSummary.push(`> Total games played: ${totalGames}`)
  overallSummary.push('')
  overallSummary.push('## Overall Win Rates')
  overallSummary.push('')
  overallSummary.push(`| Metric | Value |`)
  overallSummary.push(`|--------|-------|`)
  overallSummary.push(`| Total Games | ${totalGames} |`)
  overallSummary.push(`| P1 Overall Win Rate | ${((totalP1Wins / totalGames) * 100).toFixed(1)}% |`)
  overallSummary.push(`| P2 Overall Win Rate | ${((totalP2Wins / totalGames) * 100).toFixed(1)}% |`)
  overallSummary.push(`| Draw Rate | ${((totalDraws / totalGames) * 100).toFixed(1)}% |`)
  overallSummary.push('')
  overallSummary.push('---')
  overallSummary.push('')

  for (let i = 0; i < allStrategyLines.length; i += 1) {
    overallSummary.push(`## Matchup ${i + 1}`)
    overallSummary.push('')
    overallSummary.push(allStrategyLines[i])
    overallSummary.push('')
    overallSummary.push('---')
    overallSummary.push('')
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'STRATEGY_REPORT.md'),
    overallSummary.join('\n'),
  )

  // Save updated weights for learning agents
  const savedWeightsPaths = new Set<string>()
  for (const matchup of matchups) {
    for (const agent of [matchup.p1, matchup.p2]) {
      if (agent.strategy === 'learning' && agent.learnedWeights != null && agent.weightsFile != null) {
        if (!savedWeightsPaths.has(agent.weightsFile)) {
          saveWeights(agent.weightsFile, agent.learnedWeights)
          fs.writeFileSync(
            path.join(OUTPUT_DIR, `${agent.name}-weights-report.md`),
            formatWeightsReport(agent.learnedWeights),
          )
          console.log(`Saved learned weights: ${agent.weightsFile} (${agent.learnedWeights.gamesPlayed} games)`)
          savedWeightsPaths.add(agent.weightsFile)
        }
      }
    }
  }

  console.log('=== Training Complete ===')
  console.log(`Full output written to: ${OUTPUT_DIR}`)
  console.log(`Strategy report: ${path.join(OUTPUT_DIR, 'STRATEGY_REPORT.md')}`)
}

main()
