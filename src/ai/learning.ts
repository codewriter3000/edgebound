import * as fs from 'node:fs'
import type { SetupStrategy, OpeningStrategy, TacticStrategy, StrategyDetail } from './agent'
import { SETUP_STRATEGIES, OPENING_STRATEGIES, TACTIC_STRATEGIES } from './agent'

// ---- Weight data structure ----

export interface PhaseWeights {
  setup: Record<SetupStrategy, number>
  opening: Record<OpeningStrategy, number>
  tactic: Record<TacticStrategy, number>
}

export interface LearnedWeights {
  version: number
  gamesPlayed: number
  weights: PhaseWeights
}

const CURRENT_VERSION = 1

// ---- Initialization ----

function uniformWeights<T extends string>(keys: readonly T[]): Record<T, number> {
  const w = {} as Record<T, number>
  for (const k of keys) {
    w[k] = 1
  }
  return w
}

export function createInitialWeights(): LearnedWeights {
  return {
    version: CURRENT_VERSION,
    gamesPlayed: 0,
    weights: {
      setup: uniformWeights(SETUP_STRATEGIES),
      opening: uniformWeights(OPENING_STRATEGIES),
      tactic: uniformWeights(TACTIC_STRATEGIES),
    },
  }
}

// ---- Weighted random selection ----

function weightedRandom<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as Array<[T, number]>
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let remaining = Math.random() * total
  for (const [key, weight] of entries) {
    remaining -= weight
    if (remaining <= 0) return key
  }
  return entries[entries.length - 1][0]
}

export function pickStrategy(weights: LearnedWeights): StrategyDetail {
  return {
    setup: weightedRandom(weights.weights.setup),
    opening: weightedRandom(weights.weights.opening),
    tactic: weightedRandom(weights.weights.tactic),
  }
}

// ---- Reinforcement ----

const WIN_BOOST = 0.1
const LOSS_PENALTY = 0.05
const MIN_WEIGHT = 0.05

function adjustWeight(current: number, delta: number): number {
  return Math.max(MIN_WEIGHT, current + delta)
}

export function reinforceWin(weights: LearnedWeights, strategy: StrategyDetail): void {
  weights.weights.setup[strategy.setup] = adjustWeight(weights.weights.setup[strategy.setup], WIN_BOOST)
  weights.weights.opening[strategy.opening] = adjustWeight(weights.weights.opening[strategy.opening], WIN_BOOST)
  weights.weights.tactic[strategy.tactic] = adjustWeight(weights.weights.tactic[strategy.tactic], WIN_BOOST)
}

export function reinforceLoss(weights: LearnedWeights, strategy: StrategyDetail): void {
  weights.weights.setup[strategy.setup] = adjustWeight(weights.weights.setup[strategy.setup], -LOSS_PENALTY)
  weights.weights.opening[strategy.opening] = adjustWeight(weights.weights.opening[strategy.opening], -LOSS_PENALTY)
  weights.weights.tactic[strategy.tactic] = adjustWeight(weights.weights.tactic[strategy.tactic], -LOSS_PENALTY)
}

// ---- File I/O ----

export function saveWeights(filePath: string, weights: LearnedWeights): void {
  fs.writeFileSync(filePath, JSON.stringify(weights, null, 2))
}

export function loadWeights(filePath: string): LearnedWeights {
  const content = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(content) as LearnedWeights

  if (data.version !== CURRENT_VERSION) {
    throw new Error(`Unsupported weights version: ${data.version}. Expected ${CURRENT_VERSION}.`)
  }

  validateWeights(data)
  return data
}

export function loadOrCreateWeights(filePath: string): LearnedWeights {
  if (fs.existsSync(filePath)) {
    return loadWeights(filePath)
  }
  return createInitialWeights()
}

function validateWeights(data: LearnedWeights): void {
  for (const key of SETUP_STRATEGIES) {
    if (typeof data.weights.setup[key] !== 'number') {
      throw new Error(`Missing or invalid setup weight: ${key}`)
    }
  }
  for (const key of OPENING_STRATEGIES) {
    if (typeof data.weights.opening[key] !== 'number') {
      throw new Error(`Missing or invalid opening weight: ${key}`)
    }
  }
  for (const key of TACTIC_STRATEGIES) {
    if (typeof data.weights.tactic[key] !== 'number') {
      throw new Error(`Missing or invalid tactic weight: ${key}`)
    }
  }
}

// ---- Formatting ----

export function formatWeightsReport(weights: LearnedWeights): string {
  const lines: string[] = []
  lines.push('# Learned AI Weights')
  lines.push('')
  lines.push(`- **Version**: ${weights.version}`)
  lines.push(`- **Games Played**: ${weights.gamesPlayed}`)
  lines.push('')

  lines.push('## Setup Strategy Weights')
  lines.push('')
  lines.push('| Strategy | Weight |')
  lines.push('|----------|--------|')
  for (const key of SETUP_STRATEGIES) {
    lines.push(`| ${key} | ${weights.weights.setup[key].toFixed(3)} |`)
  }
  lines.push('')

  lines.push('## Opening Strategy Weights')
  lines.push('')
  lines.push('| Strategy | Weight |')
  lines.push('|----------|--------|')
  for (const key of OPENING_STRATEGIES) {
    lines.push(`| ${key} | ${weights.weights.opening[key].toFixed(3)} |`)
  }
  lines.push('')

  lines.push('## Tactic Strategy Weights')
  lines.push('')
  lines.push('| Strategy | Weight |')
  lines.push('|----------|--------|')
  for (const key of TACTIC_STRATEGIES) {
    lines.push(`| ${key} | ${weights.weights.tactic[key].toFixed(3)} |`)
  }
  lines.push('')

  return lines.join('\n')
}
