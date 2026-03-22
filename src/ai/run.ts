import * as fs from 'node:fs'
import * as path from 'node:path'
import { runSelfPlay, formatSelfPlayResults, formatAllGameLogs } from './selfplay'
import type { AgentConfig } from './agent'
import { analyzeResults, formatAnalysisReport } from './analysis'
import { generateStrategyMarkdown } from './strategy-tracker'

const NUM_GAMES = parseInt(process.env.NUM_GAMES ?? '20', 10)
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? '500', 10)
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? path.resolve(import.meta.dirname, '..', '..', 'ai-output')

const matchups: Array<{ p1: AgentConfig; p2: AgentConfig }> = [
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

function main(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log('=== Edgebound AI Self-Play Training ===')
  console.log(`Running ${NUM_GAMES} games per matchup, ${matchups.length} matchups`)
  console.log(`Max turns per game: ${MAX_TURNS}`)
  console.log(`Output directory: ${OUTPUT_DIR}`)
  console.log('')

  const allStrategyLines: string[] = []
  let totalP1Wins = 0
  let totalP2Wins = 0
  let totalDraws = 0
  let totalGames = 0

  for (let m = 0; m < matchups.length; m += 1) {
    const matchup = matchups[m]
    console.log(`--- Matchup ${m + 1}: ${matchup.p1.name} (${matchup.p1.strategy}) vs ${matchup.p2.name} (${matchup.p2.strategy}) ---`)

    const result = runSelfPlay({
      p1: matchup.p1,
      p2: matchup.p2,
      numGames: NUM_GAMES,
      maxTurns: MAX_TURNS,
    })

    console.log(`  P1 Wins: ${result.p1Wins}, P2 Wins: ${result.p2Wins}, Draws: ${result.draws}`)
    console.log(`  Average game length: ${result.avgMoves.toFixed(1)} moves`)
    console.log('')

    totalP1Wins += result.p1Wins
    totalP2Wins += result.p2Wins
    totalDraws += result.draws
    totalGames += result.totalGames

    const matchupDir = path.join(OUTPUT_DIR, `matchup-${m + 1}-${matchup.p1.strategy}-vs-${matchup.p2.strategy}`)
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

  console.log('=== Training Complete ===')
  console.log(`Full output written to: ${OUTPUT_DIR}`)
  console.log(`Strategy report: ${path.join(OUTPUT_DIR, 'STRATEGY_REPORT.md')}`)
}

main()
