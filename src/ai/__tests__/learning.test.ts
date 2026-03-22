import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createInitialWeights,
  pickStrategy,
  reinforceWin,
  reinforceLoss,
  saveWeights,
  loadWeights,
  loadOrCreateWeights,
  formatWeightsReport,
} from '../learning'
import type { StrategyDetail } from '../agent'
import { SETUP_STRATEGIES, OPENING_STRATEGIES, TACTIC_STRATEGIES } from '../agent'
import { chooseAction } from '../agent'
import type { AgentConfig } from '../agent'
import { createInitialGameState, applyGameAction } from '../../game/engine'
import type { GameState } from '../../game/engine'

function tmpWeightsPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgebound-learn-'))
  return path.join(dir, 'weights.json')
}

describe('learning module', () => {
  it('creates initial weights with uniform values', () => {
    const weights = createInitialWeights()

    expect(weights.version).toBe(1)
    expect(weights.gamesPlayed).toBe(0)

    for (const key of SETUP_STRATEGIES) {
      expect(weights.weights.setup[key]).toBe(1)
    }
    for (const key of OPENING_STRATEGIES) {
      expect(weights.weights.opening[key]).toBe(1)
    }
    for (const key of TACTIC_STRATEGIES) {
      expect(weights.weights.tactic[key]).toBe(1)
    }
  })

  it('picks a valid strategy from weights', () => {
    const weights = createInitialWeights()
    const strategy = pickStrategy(weights)

    expect(SETUP_STRATEGIES).toContain(strategy.setup)
    expect(OPENING_STRATEGIES).toContain(strategy.opening)
    expect(TACTIC_STRATEGIES).toContain(strategy.tactic)
  })

  it('reinforces winning strategy by increasing weights', () => {
    const weights = createInitialWeights()
    const strategy: StrategyDetail = { setup: 'wide-spread', opening: 'rush', tactic: 'pick-heavy' }
    const beforeSetup = weights.weights.setup['wide-spread']

    reinforceWin(weights, strategy)

    expect(weights.weights.setup['wide-spread']).toBeGreaterThan(beforeSetup)
    expect(weights.weights.opening['rush']).toBeGreaterThan(1)
    expect(weights.weights.tactic['pick-heavy']).toBeGreaterThan(1)
  })

  it('reinforces losing strategy by decreasing weights', () => {
    const weights = createInitialWeights()
    const strategy: StrategyDetail = { setup: 'clustered-narrow', opening: 'hold', tactic: 'conservative' }
    const beforeSetup = weights.weights.setup['clustered-narrow']

    reinforceLoss(weights, strategy)

    expect(weights.weights.setup['clustered-narrow']).toBeLessThan(beforeSetup)
    expect(weights.weights.opening['hold']).toBeLessThan(1)
    expect(weights.weights.tactic['conservative']).toBeLessThan(1)
  })

  it('does not let weights go below the minimum', () => {
    const weights = createInitialWeights()
    const strategy: StrategyDetail = { setup: 'balanced', opening: 'mixed-opening', tactic: 'no-play-actions' }

    for (let i = 0; i < 100; i += 1) {
      reinforceLoss(weights, strategy)
    }

    expect(weights.weights.setup['balanced']).toBeGreaterThan(0)
    expect(weights.weights.opening['mixed-opening']).toBeGreaterThan(0)
    expect(weights.weights.tactic['no-play-actions']).toBeGreaterThan(0)
  })

  it('saves and loads weights from disk', () => {
    const filePath = tmpWeightsPath()
    const weights = createInitialWeights()
    weights.gamesPlayed = 42

    reinforceWin(weights, { setup: 'front-loaded', opening: 'early-pick', tactic: 'movement-focused' })

    saveWeights(filePath, weights)
    const loaded = loadWeights(filePath)

    expect(loaded.version).toBe(weights.version)
    expect(loaded.gamesPlayed).toBe(42)
    expect(loaded.weights.setup['front-loaded']).toBe(weights.weights.setup['front-loaded'])
    expect(loaded.weights.opening['early-pick']).toBe(weights.weights.opening['early-pick'])
    expect(loaded.weights.tactic['movement-focused']).toBe(weights.weights.tactic['movement-focused'])
  })

  it('loadOrCreateWeights creates fresh weights if file does not exist', () => {
    const filePath = tmpWeightsPath()
    const weights = loadOrCreateWeights(filePath)

    expect(weights.gamesPlayed).toBe(0)
    for (const key of SETUP_STRATEGIES) {
      expect(weights.weights.setup[key]).toBe(1)
    }
  })

  it('loadOrCreateWeights loads existing weights from file', () => {
    const filePath = tmpWeightsPath()
    const original = createInitialWeights()
    original.gamesPlayed = 10
    saveWeights(filePath, original)

    const loaded = loadOrCreateWeights(filePath)
    expect(loaded.gamesPlayed).toBe(10)
  })

  it('formats a readable weights report', () => {
    const weights = createInitialWeights()
    weights.gamesPlayed = 100
    const report = formatWeightsReport(weights)

    expect(report).toContain('# Learned AI Weights')
    expect(report).toContain('Games Played')
    expect(report).toContain('100')
    expect(report).toContain('Setup Strategy Weights')
    expect(report).toContain('Opening Strategy Weights')
    expect(report).toContain('Tactic Strategy Weights')
  })
})

describe('learning strategy in agent', () => {
  function applySetupForBothPlayers(config: AgentConfig): GameState {
    let state = createInitialGameState()
    while (state.phase === 'setup') {
      const player = state.setupPlayer
      const action = chooseAction(state, player, config)
      if (action == null) break
      const result = applyGameAction(state, player, action)
      if (!result.accepted) break
      state = result.state
    }
    return state
  }

  it('generates valid setup placements with learning strategy', () => {
    const weights = createInitialWeights()
    const config: AgentConfig = { name: 'test-learning', strategy: 'learning', learnedWeights: weights }
    const state = createInitialGameState()
    const action = chooseAction(state, 'P2', config)

    expect(action).not.toBeNull()
    expect(action!.type).toBe('PLACE_PIECE')

    const result = applyGameAction(state, 'P2', action!)
    expect(result.accepted).toBe(true)
  })

  it('completes full setup and generates play actions with learning strategy', () => {
    const weights = createInitialWeights()
    const config: AgentConfig = { name: 'test-learning', strategy: 'learning', learnedWeights: weights }
    const state = applySetupForBothPlayers(config)

    expect(state.phase).toBe('play')
    expect(state.pieces.length).toBe(18)

    const action = chooseAction(state, 'P1', config)
    expect(action).not.toBeNull()

    const result = applyGameAction(state, 'P1', action!)
    expect(result.accepted).toBe(true)
  })

  it('throws if learning strategy used without learnedWeights', () => {
    const config: AgentConfig = { name: 'test-learning', strategy: 'learning' }
    const state = createInitialGameState()

    expect(() => chooseAction(state, 'P2', config)).toThrow(/learnedWeights/)
  })
})
