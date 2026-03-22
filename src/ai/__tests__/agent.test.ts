import { describe, expect, it } from 'vitest'
import { chooseAction } from '../agent'
import type { AgentConfig, StrategyDetail } from '../agent'
import { SETUP_STRATEGIES, OPENING_STRATEGIES, TACTIC_STRATEGIES } from '../agent'
import { createInitialGameState, applyGameAction } from '../../game/engine'
import type { GameState } from '../../game/engine'

function applySetupForBothPlayers(config?: AgentConfig): GameState {
  let state = createInitialGameState()
  const c: AgentConfig = config ?? { name: 'test-agent', strategy: 'random' }

  while (state.phase === 'setup') {
    const player = state.setupPlayer
    const action = chooseAction(state, player, c)
    if (action == null) break
    const result = applyGameAction(state, player, action)
    if (!result.accepted) break
    state = result.state
  }

  return state
}

describe('AI agent', () => {
  it('generates valid setup placements for P2', () => {
    const state = createInitialGameState()
    const config: AgentConfig = { name: 'test-agent', strategy: 'random' }
    const action = chooseAction(state, 'P2', config)

    expect(action).not.toBeNull()
    expect(action!.type).toBe('PLACE_PIECE')

    const result = applyGameAction(state, 'P2', action!)
    expect(result.accepted).toBe(true)
  })

  it('completes full setup phase for both players', () => {
    const state = applySetupForBothPlayers()

    expect(state.phase).toBe('play')
    expect(state.pieces.length).toBe(18)
  })

  it('generates valid play actions with random strategy', () => {
    const state = applySetupForBothPlayers()
    const config: AgentConfig = { name: 'test-random', strategy: 'random' }
    const action = chooseAction(state, 'P1', config)

    expect(action).not.toBeNull()

    const result = applyGameAction(state, 'P1', action!)
    expect(result.accepted).toBe(true)
  })

  it('generates valid play actions with aggressive strategy', () => {
    const state = applySetupForBothPlayers()
    const config: AgentConfig = { name: 'test-aggressive', strategy: 'aggressive' }
    const action = chooseAction(state, 'P1', config)

    expect(action).not.toBeNull()

    const result = applyGameAction(state, 'P1', action!)
    expect(result.accepted).toBe(true)
  })

  it('generates valid play actions with defensive strategy', () => {
    const state = applySetupForBothPlayers()
    const config: AgentConfig = { name: 'test-defensive', strategy: 'defensive' }
    const action = chooseAction(state, 'P1', config)

    expect(action).not.toBeNull()

    const result = applyGameAction(state, 'P1', action!)
    expect(result.accepted).toBe(true)
  })

  it('returns null for finished games', () => {
    const state: GameState = {
      phase: 'finished',
      pieces: [],
      setupPlayer: 'P1',
      turn: 'P1',
      winner: 'P1',
      actionsUsed: 0,
      actedPieceIds: [],
      pickPointIds: [],
      isFirstP1Turn: false,
    }
    const config: AgentConfig = { name: 'test', strategy: 'random' }
    const action = chooseAction(state, 'P1', config)
    expect(action).toBeNull()
  })

  it('generates valid setup placements with each setup strategy', () => {
    for (const setup of SETUP_STRATEGIES) {
      const detail: StrategyDetail = { setup, opening: 'mixed-opening', tactic: 'movement-focused' }
      const config: AgentConfig = { name: `test-${setup}`, strategy: detail }
      const state = createInitialGameState()
      const action = chooseAction(state, 'P2', config)
      expect(action, `setup strategy "${setup}"`).not.toBeNull()
      expect(action!.type).toBe('PLACE_PIECE')
      const result = applyGameAction(state, 'P2', action!)
      expect(result.accepted, `setup strategy "${setup}" should produce valid placement`).toBe(true)
    }
  })

  it('completes full setup with per-phase strategy', () => {
    const detail: StrategyDetail = { setup: 'front-loaded', opening: 'rush', tactic: 'pick-heavy' }
    const config: AgentConfig = { name: 'test-detailed', strategy: detail }
    const state = applySetupForBothPlayers(config)
    expect(state.phase).toBe('play')
    expect(state.pieces.length).toBe(18)
  })

  it('generates valid play actions with each per-phase strategy combination', () => {
    for (const opening of OPENING_STRATEGIES) {
      for (const tactic of TACTIC_STRATEGIES) {
        const detail: StrategyDetail = { setup: 'balanced', opening, tactic }
        const config: AgentConfig = { name: `test-${opening}-${tactic}`, strategy: detail }
        const state = applySetupForBothPlayers(config)
        const action = chooseAction(state, 'P1', config)
        expect(action, `strategy ${opening}/${tactic}`).not.toBeNull()
        const result = applyGameAction(state, 'P1', action!)
        expect(result.accepted, `strategy ${opening}/${tactic} should produce valid action`).toBe(true)
      }
    }
  })
})
