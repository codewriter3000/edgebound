import { describe, expect, it } from 'vitest'
import { playSingleGame, runSelfPlay, formatSelfPlayResults, formatAllGameLogs } from '../selfplay'
import type { AgentConfig } from '../agent'
import { SETUP_STRATEGIES, OPENING_STRATEGIES, TACTIC_STRATEGIES } from '../agent'
import { formatGameLog } from '../logger'
import { analyzeResults, formatAnalysisReport } from '../analysis'
import { generateStrategyMarkdown } from '../strategy-tracker'
import { createInitialWeights, reinforceWin, reinforceLoss } from '../learning'

const randomP1: AgentConfig = { name: 'Random-P1', strategy: 'random' }
const randomP2: AgentConfig = { name: 'Random-P2', strategy: 'random' }
const aggressiveP1: AgentConfig = { name: 'Aggressive-P1', strategy: 'aggressive' }
const defensiveP2: AgentConfig = { name: 'Defensive-P2', strategy: 'defensive' }

describe('self-play', () => {
  it('plays a single game to completion', () => {
    const log = playSingleGame(1, randomP1, randomP2, 500)

    expect(log.gameId).toBe(1)
    expect(log.totalMoves).toBeGreaterThan(0)
    expect(log.moves.length).toBeGreaterThan(0)
    expect(log.endTime).toBeGreaterThan(log.startTime)
  })

  it('records all moves in the game log', () => {
    const log = playSingleGame(1, randomP1, randomP2, 500)

    for (const entry of log.moves) {
      expect(entry.moveNumber).toBeGreaterThan(0)
      expect(['P1', 'P2']).toContain(entry.player)
      expect(entry.action).toBeDefined()
      expect(entry.resultState).toBeDefined()
    }
  })

  it('formats game log as readable markdown', () => {
    const log = playSingleGame(1, randomP1, randomP2, 500)
    const formatted = formatGameLog(log)

    expect(formatted).toContain('# Game 1 Log')
    expect(formatted).toContain('Random-P1')
    expect(formatted).toContain('Random-P2')
    expect(formatted).toContain('## Move-by-Move Log')
    expect(formatted).toContain('## Final Board State')
  })

  it('runs multiple games and aggregates results', () => {
    const result = runSelfPlay({
      p1: randomP1,
      p2: randomP2,
      numGames: 5,
      maxTurns: 500,
    })

    expect(result.totalGames).toBe(5)
    expect(result.p1Wins + result.p2Wins + result.draws).toBe(5)
    expect(result.logs.length).toBe(5)
    expect(result.avgMoves).toBeGreaterThan(0)
  })

  it('formats self-play results as markdown', () => {
    const result = runSelfPlay({
      p1: randomP1,
      p2: randomP2,
      numGames: 3,
      maxTurns: 500,
    })

    const formatted = formatSelfPlayResults(result)
    expect(formatted).toContain('# Self-Play Session Results')
    expect(formatted).toContain('Total Games')
    expect(formatted).toContain('P1 Wins')
  })

  it('formats all game logs', () => {
    const result = runSelfPlay({
      p1: randomP1,
      p2: randomP2,
      numGames: 2,
      maxTurns: 500,
    })

    const formatted = formatAllGameLogs(result)
    expect(formatted).toContain('# Complete Game Logs')
    expect(formatted).toContain('# Game 1 Log')
    expect(formatted).toContain('# Game 2 Log')
  })
})

describe('game analysis', () => {
  it('analyzes results and produces a report', () => {
    const result = runSelfPlay({
      p1: aggressiveP1,
      p2: defensiveP2,
      numGames: 5,
      maxTurns: 500,
    })

    const report = analyzeResults(result)

    expect(report.solvabilityAssessment).toBeTruthy()
    expect(report.firstPlayerAdvantage).toBeTruthy()
    expect(report.drawRate).toBeTruthy()
    expect(report.avgGameLength).toBeTruthy()
    expect(report.setupPatterns.length).toBeGreaterThan(0)
    expect(report.ruleChangeRecommendations.length).toBeGreaterThan(0)
  })

  it('formats analysis report as markdown', () => {
    const result = runSelfPlay({
      p1: aggressiveP1,
      p2: defensiveP2,
      numGames: 3,
      maxTurns: 500,
    })

    const report = analyzeResults(result)
    const formatted = formatAnalysisReport(report)

    expect(formatted).toContain('# Game Analysis Report')
    expect(formatted).toContain('## Solvability Assessment')
    expect(formatted).toContain('## First-Player Advantage')
    expect(formatted).toContain('## Board Setup Patterns')
    expect(formatted).toContain('## Rule Change Recommendations')
  })
})

describe('strategy tracker', () => {
  it('generates strategy markdown report', () => {
    const result = runSelfPlay({
      p1: aggressiveP1,
      p2: defensiveP2,
      numGames: 5,
      maxTurns: 500,
    })

    const markdown = generateStrategyMarkdown(result)

    expect(markdown).toContain('# Edgebound AI Strategy Report')
    expect(markdown).toContain('## Summary')
    expect(markdown).toContain('## Strategies That Work')
    expect(markdown).toContain("## Strategies That Don't Work")
    expect(markdown).toContain('## Game Balance & Solvability')
    expect(markdown).toContain('### Rule Change Recommendations')
  })
})

describe('learning strategy in self-play', () => {
  it('tracks resolved strategies on game logs for learning agents', () => {
    const weights = createInitialWeights()
    const learnerP1: AgentConfig = { name: 'Learner-P1', strategy: 'learning', learnedWeights: weights }
    const log = playSingleGame(1, learnerP1, randomP2, 500)

    expect(log.p1Strategy).toBeDefined()
    expect(SETUP_STRATEGIES).toContain(log.p1Strategy!.setup)
    expect(OPENING_STRATEGIES).toContain(log.p1Strategy!.opening)
    expect(TACTIC_STRATEGIES).toContain(log.p1Strategy!.tactic)
    expect(log.p2Strategy).toBeUndefined()
  })

  it('tracks strategies for both players when both are learning', () => {
    const weights = createInitialWeights()
    const learnerP1: AgentConfig = { name: 'Learner-P1', strategy: 'learning', learnedWeights: weights }
    const learnerP2: AgentConfig = { name: 'Learner-P2', strategy: 'learning', learnedWeights: weights }
    const log = playSingleGame(1, learnerP1, learnerP2, 500)

    expect(log.p1Strategy).toBeDefined()
    expect(log.p2Strategy).toBeDefined()
  })

  it('does not set strategy on logs for non-learning agents', () => {
    const log = playSingleGame(1, randomP1, randomP2, 500)

    expect(log.p1Strategy).toBeUndefined()
    expect(log.p2Strategy).toBeUndefined()
  })

  it('reinforces the actual strategies used in each game via runSelfPlay', () => {
    const weights = createInitialWeights()
    const learnerP1: AgentConfig = { name: 'Learner-P1', strategy: 'learning', learnedWeights: weights }

    const result = runSelfPlay({
      p1: learnerP1,
      p2: randomP2,
      numGames: 5,
      maxTurns: 500,
    })

    for (const log of result.logs) {
      expect(log.p1Strategy).toBeDefined()
      expect(SETUP_STRATEGIES).toContain(log.p1Strategy!.setup)
      expect(OPENING_STRATEGIES).toContain(log.p1Strategy!.opening)
      expect(TACTIC_STRATEGIES).toContain(log.p1Strategy!.tactic)
    }
  })

  it('modifies weights when reinforcing tracked strategies from game logs', () => {
    const weights = createInitialWeights()
    const learnerP1: AgentConfig = { name: 'Learner-P1', strategy: 'learning', learnedWeights: weights }

    const result = runSelfPlay({
      p1: learnerP1,
      p2: randomP2,
      numGames: 10,
      maxTurns: 500,
    })

    // Simulate the reinforcement loop from run.ts using tracked strategies
    const reinforcedWeights = createInitialWeights()
    for (const log of result.logs) {
      const detail = log.p1Strategy
      if (detail == null) continue
      if (log.winner === 'P1') {
        reinforceWin(reinforcedWeights, detail)
      } else if (log.winner != null) {
        reinforceLoss(reinforcedWeights, detail)
      }
    }

    // At least one game should have produced a winner, so weights should have changed
    const decisiveGames = result.logs.filter((l) => l.winner != null)
    if (decisiveGames.length > 0) {
      const allSetupEqual = SETUP_STRATEGIES.every((k) => reinforcedWeights.weights.setup[k] === 1)
      const allOpeningEqual = OPENING_STRATEGIES.every((k) => reinforcedWeights.weights.opening[k] === 1)
      const allTacticEqual = TACTIC_STRATEGIES.every((k) => reinforcedWeights.weights.tactic[k] === 1)
      expect(allSetupEqual && allOpeningEqual && allTacticEqual).toBe(false)
    }
  })
})
