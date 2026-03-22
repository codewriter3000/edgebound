import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AgentConfig, StrategyKind, StrategyDetail } from './agent'
import { SETUP_STRATEGIES, OPENING_STRATEGIES, TACTIC_STRATEGIES, STRATEGY_KINDS } from './agent'

export interface MatchupConfig {
  p1: AgentConfig
  p2: AgentConfig
}

export interface LoadedAiConfig {
  numGames?: number
  maxTurns?: number
  outputDir?: string
  matchups: MatchupConfig[]
  sourcePath: string
  sourceDir: string
}

type RawStrategyDetail = {
  setup?: string
  opening?: string
  tactic?: string
}

type RawAgentConfig =
  | StrategyKind
  | {
      name?: string
      strategy?: string | RawStrategyDetail
      weightsFile?: string
    }

interface RawAiConfig {
  numGames?: number
  maxTurns?: number
  outputDir?: string
  matchups?: Array<{
    p1?: RawAgentConfig
    p2?: RawAgentConfig
  }>
}

function isStrategyKind(value: string): value is StrategyKind {
  return (STRATEGY_KINDS as readonly string[]).includes(value)
}

function normalizeStrategyDetail(
  raw: RawStrategyDetail,
  side: 'P1' | 'P2',
  matchupIndex: number,
): StrategyDetail {
  const { setup, opening, tactic } = raw

  if (typeof setup !== 'string' || !(SETUP_STRATEGIES as readonly string[]).includes(setup)) {
    throw new Error(
      `Matchup ${matchupIndex + 1}: ${side}.strategy.setup "${setup ?? ''}" is invalid. ` +
      `Use ${SETUP_STRATEGIES.join(', ')}.`,
    )
  }

  if (typeof opening !== 'string' || !(OPENING_STRATEGIES as readonly string[]).includes(opening)) {
    throw new Error(
      `Matchup ${matchupIndex + 1}: ${side}.strategy.opening "${opening ?? ''}" is invalid. ` +
      `Use ${OPENING_STRATEGIES.join(', ')}.`,
    )
  }

  if (typeof tactic !== 'string' || !(TACTIC_STRATEGIES as readonly string[]).includes(tactic)) {
    throw new Error(
      `Matchup ${matchupIndex + 1}: ${side}.strategy.tactic "${tactic ?? ''}" is invalid. ` +
      `Use ${TACTIC_STRATEGIES.join(', ')}.`,
    )
  }

  return { setup, opening, tactic } as StrategyDetail
}

function normalizePositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value == null) {
    return undefined
  }

  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`)
  }

  return value as number
}

function normalizeAgent(
  raw: RawAgentConfig | undefined,
  side: 'P1' | 'P2',
  matchupIndex: number,
): AgentConfig {
  if (raw == null) {
    throw new Error(`Matchup ${matchupIndex + 1}: ${side} must be provided.`)
  }

  if (typeof raw === 'string') {
    if (!isStrategyKind(raw)) {
      throw new Error(
        `Matchup ${matchupIndex + 1}: ${side} strategy "${raw}" is invalid. ` +
        `Use ${STRATEGY_KINDS.join(', ')}, or an object with setup/opening/tactic.`,
      )
    }

    return {
      name: `${side}-${raw}-${matchupIndex + 1}`,
      strategy: raw,
    }
  }

  if (typeof raw !== 'object') {
    throw new Error(`Matchup ${matchupIndex + 1}: ${side} must be a strategy string or object.`)
  }

  if (raw.name != null && typeof raw.name !== 'string') {
    throw new Error(`Matchup ${matchupIndex + 1}: ${side}.name must be a string.`)
  }

  const strategy = raw.strategy

  if (typeof strategy === 'object' && strategy != null) {
    const detail = normalizeStrategyDetail(strategy, side, matchupIndex)
    const label = `${detail.setup}-${detail.opening}-${detail.tactic}`
    return {
      name: raw.name?.trim() || `${side}-${label}-${matchupIndex + 1}`,
      strategy: detail,
    }
  }

  if (typeof strategy !== 'string' || !isStrategyKind(strategy)) {
    throw new Error(
      `Matchup ${matchupIndex + 1}: ${side}.strategy is invalid. ` +
      `Use ${STRATEGY_KINDS.join(', ')}, or an object with setup/opening/tactic.`,
    )
  }

  if (strategy === 'learning' && (raw.weightsFile == null || typeof raw.weightsFile !== 'string')) {
    throw new Error(
      `Matchup ${matchupIndex + 1}: ${side} uses "learning" strategy but is missing a "weightsFile" path.`,
    )
  }

  return {
    name: raw.name?.trim() || `${side}-${strategy}-${matchupIndex + 1}`,
    strategy,
    ...(strategy === 'learning' ? { weightsFile: raw.weightsFile } : {}),
  }
}

export function loadAiConfig(configPath: string): LoadedAiConfig {
  const resolvedPath = path.resolve(configPath)
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`AI config file not found: ${resolvedPath}`)
  }

  const content = fs.readFileSync(resolvedPath, 'utf8')
  const parsed = parseYaml(content) as RawAiConfig

  if (parsed == null || typeof parsed !== 'object') {
    throw new Error('AI config must be a YAML object.')
  }

  if (!Array.isArray(parsed.matchups) || parsed.matchups.length === 0) {
    throw new Error('AI config requires a non-empty "matchups" array.')
  }

  if (parsed.outputDir != null && typeof parsed.outputDir !== 'string') {
    throw new Error('outputDir must be a string when provided.')
  }

  const matchups = parsed.matchups.map((matchup, matchupIndex) => {
    if (matchup == null || typeof matchup !== 'object') {
      throw new Error(`Matchup ${matchupIndex + 1} must be an object with p1 and p2.`)
    }

    return {
      p1: normalizeAgent(matchup.p1, 'P1', matchupIndex),
      p2: normalizeAgent(matchup.p2, 'P2', matchupIndex),
    }
  })

  return {
    numGames: normalizePositiveInteger(parsed.numGames, 'numGames'),
    maxTurns: normalizePositiveInteger(parsed.maxTurns, 'maxTurns'),
    outputDir: parsed.outputDir,
    matchups,
    sourcePath: resolvedPath,
    sourceDir: path.dirname(resolvedPath),
  }
}
