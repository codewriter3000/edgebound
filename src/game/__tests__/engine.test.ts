import { describe, expect, it } from 'vitest'
import { applyGameAction, createInitialGameState } from '../engine'
import type { Player } from '../types'

function placeSetupPiecesToStartPlay() {
  let state = createInitialGameState()

  // New interleaved setup: P1 places 1, P2 places 2, P1 places 2, repeat.
  // With 9 pieces each (4 triangles + 3 squares + 2 circles) the full sequence is:
  // Turn 1 – P1:1, Turn 2 – P2:2, Turn 3 – P1:2, Turn 4 – P2:2, Turn 5 – P1:2,
  // Turn 6 – P2:2, Turn 7 – P1:2, Turn 8 – P2:2, Turn 9 – P1:2 (P1 done), Turn 10 – P2:1.
  const placements: { player: Player; pieceType: 'triangle' | 'square' | 'circle'; spotId: string }[] = [
    // Turn 1 – P1 places 1
    { player: 'P1', pieceType: 'triangle', spotId: '3-11' },
    // Turn 2 – P2 places 2
    { player: 'P2', pieceType: 'triangle', spotId: '3-9' },
    { player: 'P2', pieceType: 'triangle', spotId: '7-9' },
    // Turn 3 – P1 places 2
    { player: 'P1', pieceType: 'triangle', spotId: '7-11' },
    { player: 'P1', pieceType: 'triangle', spotId: '11-11' },
    // Turn 4 – P2 places 2
    { player: 'P2', pieceType: 'triangle', spotId: '11-9' },
    { player: 'P2', pieceType: 'triangle', spotId: '15-9' },
    // Turn 5 – P1 places 2
    { player: 'P1', pieceType: 'triangle', spotId: '15-11' },
    { player: 'P1', pieceType: 'square', spotId: '3-15' },
    // Turn 6 – P2 places 2
    { player: 'P2', pieceType: 'square', spotId: '3-5' },
    { player: 'P2', pieceType: 'square', spotId: '7-5' },
    // Turn 7 – P1 places 2
    { player: 'P1', pieceType: 'square', spotId: '7-15' },
    { player: 'P1', pieceType: 'square', spotId: '11-15' },
    // Turn 8 – P2 places 2
    { player: 'P2', pieceType: 'square', spotId: '11-5' },
    { player: 'P2', pieceType: 'circle', spotId: '5-1' },
    // Turn 9 – P1 places 2 (P1's last 2 pieces; P1 done after this)
    { player: 'P1', pieceType: 'circle', spotId: '5-19' },
    { player: 'P1', pieceType: 'circle', spotId: '13-19' },
    // Turn 10 – P2 places 1 last piece (P2 done; setup ends)
    { player: 'P2', pieceType: 'circle', spotId: '13-1' },
  ]

  for (const placement of placements) {
    const result = applyGameAction(state, placement.player, {
      type: 'PLACE_PIECE',
      pieceType: placement.pieceType,
      spotId: placement.spotId,
    })
    expect(result.accepted).toBe(true)
    state = result.state
  }

  return state
}

describe('game engine transitions', () => {
  it('rejects out-of-turn setup placement', () => {
    const state = createInitialGameState()
    const result = applyGameAction(state, 'P2', {
      type: 'PLACE_PIECE',
      pieceType: 'triangle',
      spotId: '3-9',
    })

    expect(result.accepted).toBe(false)
    expect(result.error).toContain('setup turn')
  })

  it('transitions to play after both players complete setup', () => {
    const state = placeSetupPiecesToStartPlay()
    expect(state.phase).toBe('play')
    expect(state.turn).toBe('P1')
    expect(state.actionsUsed).toBe(0)
  })

  it('rotates turn after 3 actions on P1 first turn', () => {
    const setupDone = placeSetupPiecesToStartPlay()
    expect(setupDone.isFirstP1Turn).toBe(true)

    let state = setupDone
    const actor: Player = 'P1'
    const pieceIds = state.pieces
      .filter((piece) => piece.owner === actor && piece.type === 'triangle')
      .map((piece) => piece.id)

    const targetSpots = ['3-13', '7-13', '11-13']

    for (let i = 0; i < 3; i += 1) {
      const result = applyGameAction(state, actor, {
        type: 'MOVE_TO_SPOT',
        pieceId: pieceIds[i],
        targetSpotId: targetSpots[i],
      })
      expect(result.accepted).toBe(true)
      state = result.state
    }

    expect(state.turn).toBe('P2')
    expect(state.actionsUsed).toBe(0)
    expect(state.actedPieceIds).toEqual([])
    expect(state.isFirstP1Turn).toBe(false)
  })

  it('rotates turn after 4 actions on subsequent P1 turns', () => {
    const setupDone = placeSetupPiecesToStartPlay()

    // Exhaust P1 first turn (3 actions)
    let state = setupDone
    const p1Triangles = state.pieces
      .filter((piece) => piece.owner === 'P1' && piece.type === 'triangle')
      .map((piece) => piece.id)
    for (let i = 0; i < 3; i += 1) {
      const result = applyGameAction(state, 'P1', {
        type: 'MOVE_TO_SPOT',
        pieceId: p1Triangles[i],
        targetSpotId: ['3-13', '7-13', '11-13'][i],
      })
      state = result.state
    }
    expect(state.turn).toBe('P2')

    // End P2 turn immediately
    const endP2 = applyGameAction(state, 'P2', { type: 'END_TURN' })
    state = endP2.state
    expect(state.turn).toBe('P1')
    expect(state.isFirstP1Turn).toBe(false)

    // P1 second turn should allow 4 actions
    const p1TriIds = state.pieces
      .filter((piece) => piece.owner === 'P1' && piece.type === 'triangle')
      .map((piece) => piece.id)
    const spots2 = ['3-11', '7-11', '11-11', '15-13']
    for (let i = 0; i < 4; i += 1) {
      const result = applyGameAction(state, 'P1', {
        type: 'MOVE_TO_SPOT',
        pieceId: p1TriIds[i],
        targetSpotId: spots2[i],
      })
      expect(result.accepted).toBe(true)
      state = result.state
    }
    expect(state.turn).toBe('P2')
  })

  it('handles pick action by locking both pieces and blocking pick point', () => {
    const state = {
      ...createInitialGameState(),
      phase: 'play' as const,
      turn: 'P1' as const,
      pieces: [
        {
          id: 'P1-triangle-1',
          owner: 'P1' as const,
          type: 'triangle' as const,
          spotId: '5-5',
          locked: false,
          hasMoved: false,
        },
        {
          id: 'P2-square-1',
          owner: 'P2' as const,
          type: 'square' as const,
          spotId: '6-4',
          locked: false,
          hasMoved: false,
        },
      ],
    }

    const result = applyGameAction(state, 'P1', {
      type: 'PICK_PIECE',
      pieceId: 'P1-triangle-1',
      targetPieceId: 'P2-square-1',
    })

    expect(result.accepted).toBe(true)

    const moved = result.state.pieces.find((piece) => piece.id === 'P1-triangle-1')
    const picked = result.state.pieces.find((piece) => piece.id === 'P2-square-1')

    expect(moved?.locked).toBe(true)
    expect(picked?.locked).toBe(true)
    expect(result.state.pickPointIds).toContain('6-4')
  })
})
