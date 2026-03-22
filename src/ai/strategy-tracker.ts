import type { SelfPlayResult } from './selfplay'
import { analyzeResults } from './analysis'

export function generateStrategyMarkdown(result: SelfPlayResult): string {
  const report = analyzeResults(result)
  const lines: string[] = []

  lines.push('# Edgebound AI Strategy Report')
  lines.push('')
  lines.push(`> Auto-generated from ${result.totalGames} self-play games`)
  lines.push(`> Last updated: ${new Date().toISOString()}`)
  lines.push('')

  lines.push('## Summary')
  lines.push('')
  lines.push(`| Metric | Value |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Total Games | ${result.totalGames} |`)
  lines.push(`| P1 Win Rate | ${((result.p1Wins / result.totalGames) * 100).toFixed(1)}% |`)
  lines.push(`| P2 Win Rate | ${((result.p2Wins / result.totalGames) * 100).toFixed(1)}% |`)
  lines.push(`| Draw Rate | ${((result.draws / result.totalGames) * 100).toFixed(1)}% |`)
  lines.push(`| Avg Game Length | ${result.avgMoves.toFixed(1)} moves |`)
  lines.push('')

  lines.push('---')
  lines.push('')

  lines.push('## Strategies That Work')
  lines.push('')

  const winningSetups = report.setupPatterns
    .filter((p) => p.winRate > 0.5 && p.frequency >= 2)
    .sort((a, b) => b.winRate - a.winRate)

  if (winningSetups.length > 0) {
    lines.push('### Board Setup')
    lines.push('')
    for (const p of winningSetups) {
      lines.push(`- **${p.description}**: ${(p.winRate * 100).toFixed(1)}% win rate over ${p.frequency} games`)
    }
    lines.push('')
  }

  const winningOpenings = report.openingPatterns
    .filter((p) => p.winRate > 0.5 && p.frequency >= 2)
    .sort((a, b) => b.winRate - a.winRate)

  if (winningOpenings.length > 0) {
    lines.push('### Opening Moves')
    lines.push('')
    for (const p of winningOpenings) {
      lines.push(`- **${p.description}**: ${(p.winRate * 100).toFixed(1)}% win rate over ${p.frequency} games`)
    }
    lines.push('')
  }

  const winningTactics = report.tacticPatterns
    .filter((p) => p.winRate > 0.5 && p.frequency >= 2)
    .sort((a, b) => b.winRate - a.winRate)

  if (winningTactics.length > 0) {
    lines.push('### Tactics')
    lines.push('')
    for (const p of winningTactics) {
      lines.push(`- **${p.description}**: ${(p.winRate * 100).toFixed(1)}% win rate over ${p.frequency} games`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')

  lines.push('## Strategies That Don\'t Work')
  lines.push('')

  const losingSetups = report.setupPatterns
    .filter((p) => p.winRate < 0.4 && p.frequency >= 2)
    .sort((a, b) => a.winRate - b.winRate)

  if (losingSetups.length > 0) {
    lines.push('### Board Setup')
    lines.push('')
    for (const p of losingSetups) {
      lines.push(`- **${p.description}**: Only ${(p.winRate * 100).toFixed(1)}% win rate over ${p.frequency} games`)
    }
    lines.push('')
  }

  const losingOpenings = report.openingPatterns
    .filter((p) => p.winRate < 0.4 && p.frequency >= 2)
    .sort((a, b) => a.winRate - b.winRate)

  if (losingOpenings.length > 0) {
    lines.push('### Opening Moves')
    lines.push('')
    for (const p of losingOpenings) {
      lines.push(`- **${p.description}**: Only ${(p.winRate * 100).toFixed(1)}% win rate over ${p.frequency} games`)
    }
    lines.push('')
  }

  const losingTactics = report.tacticPatterns
    .filter((p) => p.winRate < 0.4 && p.frequency >= 2)
    .sort((a, b) => a.winRate - b.winRate)

  if (losingTactics.length > 0) {
    lines.push('### Tactics')
    lines.push('')
    for (const p of losingTactics) {
      lines.push(`- **${p.description}**: Only ${(p.winRate * 100).toFixed(1)}% win rate over ${p.frequency} games`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')

  lines.push('## Game Balance & Solvability')
  lines.push('')
  lines.push('### Solvability')
  lines.push('')
  lines.push(report.solvabilityAssessment)
  lines.push('')
  lines.push('### First-Player Advantage')
  lines.push('')
  lines.push(report.firstPlayerAdvantage)
  lines.push('')

  lines.push('### Rule Change Recommendations')
  lines.push('')
  for (let i = 0; i < report.ruleChangeRecommendations.length; i += 1) {
    lines.push(`${i + 1}. ${report.ruleChangeRecommendations[i]}`)
  }
  lines.push('')

  return lines.join('\n')
}
