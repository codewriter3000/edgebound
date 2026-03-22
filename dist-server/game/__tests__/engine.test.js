import { describe, expect, it } from 'vitest';
import { applyGameAction, createInitialGameState } from '../engine';
function placeSetupPiecesToStartPlay() {
    let state = createInitialGameState();
    const p1Placements = [
        { pieceType: 'triangle', spotId: '3-11' },
        { pieceType: 'triangle', spotId: '7-11' },
        { pieceType: 'triangle', spotId: '11-11' },
        { pieceType: 'triangle', spotId: '15-11' },
        { pieceType: 'square', spotId: '3-15' },
        { pieceType: 'square', spotId: '7-15' },
        { pieceType: 'square', spotId: '11-15' },
        { pieceType: 'circle', spotId: '5-19' },
        { pieceType: 'circle', spotId: '13-19' },
    ];
    for (const placement of p1Placements) {
        const result = applyGameAction(state, 'P1', {
            type: 'PLACE_PIECE',
            pieceType: placement.pieceType,
            spotId: placement.spotId,
        });
        expect(result.accepted).toBe(true);
        state = result.state;
    }
    expect(state.setupPlayer).toBe('P2');
    const p2Placements = [
        { pieceType: 'triangle', spotId: '3-9' },
        { pieceType: 'triangle', spotId: '7-9' },
        { pieceType: 'triangle', spotId: '11-9' },
        { pieceType: 'triangle', spotId: '15-9' },
        { pieceType: 'square', spotId: '3-5' },
        { pieceType: 'square', spotId: '7-5' },
        { pieceType: 'square', spotId: '11-5' },
        { pieceType: 'circle', spotId: '5-1' },
        { pieceType: 'circle', spotId: '13-1' },
    ];
    for (const placement of p2Placements) {
        const result = applyGameAction(state, 'P2', {
            type: 'PLACE_PIECE',
            pieceType: placement.pieceType,
            spotId: placement.spotId,
        });
        expect(result.accepted).toBe(true);
        state = result.state;
    }
    return state;
}
describe('game engine transitions', () => {
    it('rejects out-of-turn setup placement', () => {
        const state = createInitialGameState();
        const result = applyGameAction(state, 'P2', {
            type: 'PLACE_PIECE',
            pieceType: 'triangle',
            spotId: '3-11',
        });
        expect(result.accepted).toBe(false);
        expect(result.error).toContain('setup turn');
    });
    it('transitions to play after both players complete setup', () => {
        const state = placeSetupPiecesToStartPlay();
        expect(state.phase).toBe('play');
        expect(state.turn).toBe('P1');
        expect(state.actionsUsed).toBe(0);
    });
    it('rotates turn after max actions are used', () => {
        const setupDone = placeSetupPiecesToStartPlay();
        let state = setupDone;
        const actor = 'P1';
        const pieceIds = state.pieces
            .filter((piece) => piece.owner === actor && piece.type === 'triangle')
            .map((piece) => piece.id);
        const targetSpots = ['3-13', '7-13', '11-13', '15-13'];
        for (let i = 0; i < 4; i += 1) {
            const result = applyGameAction(state, actor, {
                type: 'MOVE_TO_SPOT',
                pieceId: pieceIds[i],
                targetSpotId: targetSpots[i],
            });
            expect(result.accepted).toBe(true);
            state = result.state;
        }
        expect(state.turn).toBe('P2');
        expect(state.actionsUsed).toBe(0);
        expect(state.actedPieceIds).toEqual([]);
    });
    it('handles pick action by locking both pieces and blocking pick point', () => {
        const state = {
            ...createInitialGameState(),
            phase: 'play',
            turn: 'P1',
            pieces: [
                {
                    id: 'P1-triangle-1',
                    owner: 'P1',
                    type: 'triangle',
                    spotId: '5-5',
                    locked: false,
                    hasMoved: false,
                },
                {
                    id: 'P2-square-1',
                    owner: 'P2',
                    type: 'square',
                    spotId: '6-4',
                    locked: false,
                    hasMoved: false,
                },
            ],
        };
        const result = applyGameAction(state, 'P1', {
            type: 'PICK_PIECE',
            pieceId: 'P1-triangle-1',
            targetPieceId: 'P2-square-1',
        });
        expect(result.accepted).toBe(true);
        const moved = result.state.pieces.find((piece) => piece.id === 'P1-triangle-1');
        const picked = result.state.pieces.find((piece) => piece.id === 'P2-square-1');
        expect(moved?.locked).toBe(true);
        expect(picked?.locked).toBe(true);
        expect(result.state.pickPointIds).toContain('6-4');
    });
});
