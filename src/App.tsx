import { useMemo, useState } from 'react'
import GameBoard from './components/GameBoard'
import {
  LATTICE_MAX,
  MAX_MOVES_PER_TURN,
  PIECE_LIMITS,
  SHAPES,
} from './game/constants'
import { SPOT_BY_ID } from './game/board'
import {
  canPlaceInSetup,
  hasRequiredSetupSpacing,
  otherPlayer,
  typeLabel,
} from './game/rules'
import {
  buildOccupancyMap,
  computeValidMoveTargets,
  computeValidPickTargets,
} from './game/movement'
import type { Phase, Piece, PieceType, Player, Spot } from './game/types'

export default function App() {
  const [phase, setPhase] = useState<Phase>('setup')
  const [pieces, setPieces] = useState<Piece[]>([])
  const [setupPlayer, setSetupPlayer] = useState<Player>('P1')
  const [turn, setTurn] = useState<Player>('P1')
  const [winner, setWinner] = useState<Player | null>(null)
  const [selectedType, setSelectedType] = useState<PieceType>('triangle')
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null)
  const [actionMode, setActionMode] = useState<'move' | 'pick'>('move')
  const [actionsUsed, setActionsUsed] = useState(0)
  const [actedPieceIds, setActedPieceIds] = useState<string[]>([])
  const [pickPointIds, setPickPointIds] = useState<string[]>([])

  const occupancy = useMemo(() => buildOccupancyMap(pieces), [pieces])

  const blockedPickPointIds = useMemo(() => new Set(pickPointIds), [pickPointIds])

  const setupCounts = useMemo(() => {
    const counts = {
      P1: { triangle: 0, square: 0, circle: 0 },
      P2: { triangle: 0, square: 0, circle: 0 },
    }

    pieces.forEach((piece) => {
      counts[piece.owner][piece.type] += 1
    })

    return counts
  }, [pieces])

  const selectablePieces = useMemo(() => {
    if (phase !== 'play' || actionsUsed >= MAX_MOVES_PER_TURN) {
      return new Set<string>()
    }

    const ids = new Set<string>()
    pieces.forEach((piece) => {
      if (piece.owner === turn && !piece.locked && !actedPieceIds.includes(piece.id)) {
        ids.add(piece.id)
      }
    })

    return ids
  }, [phase, actionsUsed, pieces, turn, actedPieceIds])

  const selectedPiece =
    selectedPieceId == null
      ? null
      : pieces.find((piece) => piece.id === selectedPieceId) ?? null

  const validMoveTargets = useMemo(() => {
    return computeValidMoveTargets({
      phase,
      actionMode,
      actionsUsed,
      turn,
      selectedPiece,
      actedPieceIds,
      pieces,
      occupancy,
      blockedPickPointIds,
    })
  }, [
    phase,
    actionMode,
    actionsUsed,
    turn,
    selectedPiece,
    actedPieceIds,
    pieces,
    occupancy,
    blockedPickPointIds,
  ])

  const validPickTargets = useMemo(() => {
    return computeValidPickTargets({
      phase,
      actionMode,
      turn,
      selectedPiece,
      actedPieceIds,
      pieces,
      occupancy,
      blockedPickPointIds,
    })
  }, [phase, selectedPiece, actionMode, turn, actedPieceIds, pieces, occupancy, blockedPickPointIds])

  const selectedMoveHints = useMemo(() => {
    if (phase !== 'play' || selectedPiece == null) {
      return null
    }

    const origin = SPOT_BY_ID.get(selectedPiece.spotId)
    if (origin == null) {
      return null
    }

    const destinationSpots = [...validMoveTargets]
      .map((id) => SPOT_BY_ID.get(id))
      .filter((spot): spot is Spot => spot != null)
      .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))

    let ruleSummary = ''

    if (selectedPiece.type === 'triangle') {
      ruleSummary =
        'Triangle: full-step and half-step in all directions. Can end on square, line, or corner if unobstructed.'
    } else if (origin.kind === 'square') {
      ruleSummary =
        selectedPiece.type === 'square'
          ? 'Square: from square-center, move 1 or 2 spaces in 8 directions to square centers.'
          : 'Circle: from square-center, move 1, 2, or 3 spaces in 8 directions to square centers.'
    } else {
      ruleSummary =
        selectedPiece.type === 'square'
          ? 'Square: from line/corner, use edge mapping to reachable square centers.'
          : 'Circle: from line/corner, use edge mapping (up to 3) to reachable square centers.'
    }

    return {
      pieceLabel: typeLabel(selectedPiece.type),
      originLabel: `${origin.id} (${origin.kind})`,
      ruleSummary,
      destinationLabels: destinationSpots.map((spot) => `${spot.id} (${spot.kind})`),
    }
  }, [phase, selectedPiece, validMoveTargets])

  function allPlacedFor(player: Player): boolean {
    const counts = setupCounts[player]
    return SHAPES.every((shape) => counts[shape] === PIECE_LIMITS[shape])
  }

  function checkWin(nextPieces: Piece[]): Player | null {
    const p1Reached = nextPieces.some((piece) => {
      if (piece.owner !== 'P1') {
        return false
      }

      const spot = SPOT_BY_ID.get(piece.spotId)
      return spot?.kind === 'square' && spot.y === 1
    })

    if (p1Reached) {
      return 'P1'
    }

    const p2Reached = nextPieces.some((piece) => {
      if (piece.owner !== 'P2') {
        return false
      }

      const spot = SPOT_BY_ID.get(piece.spotId)
      return spot?.kind === 'square' && spot.y === LATTICE_MAX - 1
    })

    if (p2Reached) {
      return 'P2'
    }

    return null
  }

  function registerAction(updatedPieces: Piece[], actorId: string, newPickPointId?: string) {
    const maybeWinner = checkWin(updatedPieces)
    if (maybeWinner != null) {
      setPieces(updatedPieces)
      if (newPickPointId != null) {
        setPickPointIds((prev) => (prev.includes(newPickPointId) ? prev : [...prev, newPickPointId]))
      }
      setWinner(maybeWinner)
      setPhase('finished')
      setSelectedPieceId(null)
      return
    }

    setPieces(updatedPieces)
    if (newPickPointId != null) {
      setPickPointIds((prev) => (prev.includes(newPickPointId) ? prev : [...prev, newPickPointId]))
    }

    const nextActionsUsed = actionsUsed + 1
    const nextActedPieceIds = actedPieceIds.includes(actorId)
      ? actedPieceIds
      : [...actedPieceIds, actorId]

    if (nextActionsUsed >= MAX_MOVES_PER_TURN) {
      setTurn(otherPlayer(turn))
      setSelectedPieceId(null)
      setActionMode('move')
      setActionsUsed(0)
      setActedPieceIds([])
      return
    }

    setActionsUsed(nextActionsUsed)
    setActedPieceIds(nextActedPieceIds)
  }

  function tryMoveToSpot(targetSpot: Spot): void {
    if (selectedPiece == null) {
      return
    }

    const targetPieces = occupancy.get(targetSpot.id) ?? []
    const enemyAtTarget = targetPieces.find((piece) => piece.owner !== turn && !piece.locked)

    if (enemyAtTarget != null) {
      const updatedPieces = pieces.map((piece) => {
        if (piece.id === selectedPiece.id) {
          return { ...piece, spotId: targetSpot.id, locked: true, hasMoved: true }
        }

        if (piece.id === enemyAtTarget.id) {
          return { ...piece, locked: true }
        }

        return piece
      })

      registerAction(updatedPieces, selectedPiece.id, targetSpot.id)
      return
    }

    const updatedPieces = pieces.map((piece) =>
      piece.id === selectedPiece.id
        ? { ...piece, spotId: targetSpot.id, hasMoved: true }
        : piece,
    )

    registerAction(updatedPieces, selectedPiece.id)
  }

  function handleSpotClick(spot: Spot) {
    if (phase === 'setup') {
      if ((occupancy.get(spot.id)?.length ?? 0) > 0 || !canPlaceInSetup(spot, setupPlayer)) {
        return
      }

      const ownPieces = pieces.filter((piece) => piece.owner === setupPlayer)
      if (!hasRequiredSetupSpacing(spot, ownPieces)) {
        return
      }

      const currentCount = setupCounts[setupPlayer][selectedType]
      if (currentCount >= PIECE_LIMITS[selectedType]) {
        return
      }

      const newPiece: Piece = {
        id: `${setupPlayer}-${selectedType}-${currentCount + 1}`,
        owner: setupPlayer,
        type: selectedType,
        spotId: spot.id,
        locked: false,
        hasMoved: false,
      }

      const nextPieces = [...pieces, newPiece]
      setPieces(nextPieces)

      const currentDone = SHAPES.every((shape) => {
        const value =
          shape === selectedType
            ? setupCounts[setupPlayer][shape] + 1
            : setupCounts[setupPlayer][shape]
        return value === PIECE_LIMITS[shape]
      })

      if (currentDone) {
        if (setupPlayer === 'P1') {
          setSetupPlayer('P2')
          setSelectedType('triangle')
        } else {
          setPhase('play')
          setTurn('P1')
          setSelectedPieceId(null)
          setActionsUsed(0)
          setActedPieceIds([])
          setActionMode('move')
        }
      }

      return
    }

    if (phase !== 'play' || selectedPiece == null || actionMode !== 'move') {
      return
    }

    if (actionsUsed >= MAX_MOVES_PER_TURN || !validMoveTargets.has(spot.id)) {
      return
    }

    tryMoveToSpot(spot)
  }

  function handlePieceClick(piece: Piece) {
    if (phase !== 'play') {
      return
    }

    if (selectedPiece == null) {
      if (selectablePieces.has(piece.id)) {
        setSelectedPieceId(piece.id)
      }
      return
    }

    if (piece.owner === turn) {
      if (selectablePieces.has(piece.id)) {
        setSelectedPieceId((prev) => (prev === piece.id ? null : piece.id))
      }
      return
    }

    if (actionMode === 'pick') {
      if (!validPickTargets.has(piece.id)) {
        return
      }

      const updatedPieces = pieces.map((entry) => {
        if (entry.id === selectedPiece.id) {
          return { ...entry, spotId: piece.spotId, locked: true, hasMoved: true }
        }

        if (entry.id === piece.id) {
          return { ...entry, locked: true }
        }

        return entry
      })

      registerAction(updatedPieces, selectedPiece.id, piece.spotId)
      return
    }

    const targetSpot = SPOT_BY_ID.get(piece.spotId)
    if (targetSpot == null || !validMoveTargets.has(targetSpot.id)) {
      return
    }

    tryMoveToSpot(targetSpot)
  }

  function endTurnEarly() {
    if (phase !== 'play') {
      return
    }

    setTurn((prev) => otherPlayer(prev))
    setSelectedPieceId(null)
    setActionsUsed(0)
    setActedPieceIds([])
    setActionMode('move')
  }

  function resetGame() {
    setPhase('setup')
    setPieces([])
    setSetupPlayer('P1')
    setTurn('P1')
    setWinner(null)
    setSelectedType('triangle')
    setSelectedPieceId(null)
    setActionMode('move')
    setActionsUsed(0)
    setActedPieceIds([])
    setPickPointIds([])
  }

  function getSpotClass(spot: Spot): string {
    const classes = ['spot', spot.kind]

    if (phase === 'setup') {
      const ownPieces = pieces.filter((piece) => piece.owner === setupPlayer)
      if (
        canPlaceInSetup(spot, setupPlayer) &&
        (occupancy.get(spot.id)?.length ?? 0) === 0 &&
        hasRequiredSetupSpacing(spot, ownPieces)
      ) {
        classes.push('setup-valid')
      }
    }

    if (phase === 'play' && actionMode === 'move' && validMoveTargets.has(spot.id)) {
      classes.push('move-target')
    }

    return classes.join(' ')
  }

  function canRenderSetupSpot(spot: Spot): boolean {
    const ownPieces = pieces.filter((piece) => piece.owner === setupPlayer)
    return (
      canPlaceInSetup(spot, setupPlayer) &&
      (occupancy.get(spot.id)?.length ?? 0) === 0 &&
      hasRequiredSetupSpacing(spot, ownPieces)
    )
  }

  return (
    <div className="game-shell">
      <header>
        <h1>Grid Clash 10x10</h1>
        <p>
          Place pieces on your half, then take turns making 4 actions. First to reach
          the far square row wins.
        </p>
      </header>

      <section className="panel-row">
        <div className="panel">
          <h2>Status</h2>
          {phase === 'setup' && (
            <p>
              Setup: <strong>{setupPlayer}</strong> places pieces on their half.
            </p>
          )}
          {phase === 'play' && (
            <p>
              Turn: <strong>{turn}</strong> ({actionsUsed}/{MAX_MOVES_PER_TURN} actions used)
            </p>
          )}
          {phase === 'finished' && winner != null && (
            <p>
              Winner: <strong>{winner}</strong>
            </p>
          )}
        </div>

        <div className="panel">
          <h2>Piece Limits</h2>
          <ul className="piece-list">
            {(['triangle', 'square', 'circle'] as PieceType[]).map((shape) => (
              <li key={shape}>
                <span>{typeLabel(shape)}</span>
                <span>
                  P1 {setupCounts.P1[shape]}/{PIECE_LIMITS[shape]} | P2{' '}
                  {setupCounts.P2[shape]}/{PIECE_LIMITS[shape]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {phase === 'setup' && (
        <section className="controls panel">
          <h2>Setup Controls</h2>
          <div className="button-group">
            {SHAPES.map((shape) => {
              const disabled =
                setupCounts[setupPlayer][shape] >= PIECE_LIMITS[shape] ||
                allPlacedFor(setupPlayer)
              return (
                <button
                  key={shape}
                  type="button"
                  disabled={disabled}
                  className={selectedType === shape ? 'active' : ''}
                  onClick={() => setSelectedType(shape)}
                >
                  {typeLabel(shape)}
                </button>
              )
            })}
          </div>
          <p>
            Selected: <strong>{typeLabel(selectedType)}</strong>
          </p>
          <p>
            Place only on your half, never on corners, center line, or outer edge lines.
          </p>
        </section>
      )}

      {phase === 'play' && (
        <>
          <section className="controls panel">
            <h2>Turn Controls</h2>
            <div className="button-group">
              <button
                type="button"
                className={actionMode === 'move' ? 'active' : ''}
                onClick={() => setActionMode('move')}
              >
                Move
              </button>
              <button
                type="button"
                className={actionMode === 'pick' ? 'active' : ''}
                onClick={() => setActionMode('pick')}
              >
                Set Pick
              </button>
              <button type="button" onClick={endTurnEarly}>
                End Turn Early
              </button>
            </div>
            <p>
              Each piece can act at most once per turn. Moving onto an enemy creates a pick,
              locks both pieces, and blocks that point for all uninvolved pieces.
            </p>
          </section>

          {selectedMoveHints != null && (
            <section className="controls panel">
              <h2>Selected Piece Hints</h2>
              <p>
                <strong>{selectedMoveHints.pieceLabel}</strong> at{' '}
                <strong>{selectedMoveHints.originLabel}</strong>
              </p>
              <p>{selectedMoveHints.ruleSummary}</p>
              <p>
                Legal destinations: <strong>{selectedMoveHints.destinationLabels.length}</strong>
              </p>
              {selectedMoveHints.destinationLabels.length > 0 ? (
                <p>{selectedMoveHints.destinationLabels.join(', ')}</p>
              ) : (
                <p>No legal moves from this position this turn.</p>
              )}
            </section>
          )}
        </>
      )}

      <GameBoard
        phase={phase}
        pieces={pieces}
        selectedPieceId={selectedPieceId}
        validMoveTargets={validMoveTargets}
        validPickTargets={validPickTargets}
        canRenderSetupSpot={canRenderSetupSpot}
        getSpotClass={getSpotClass}
        handleSpotClick={handleSpotClick}
        handlePieceClick={handlePieceClick}
      />

      <section className="footer-actions">
        <button type="button" onClick={resetGame}>
          New Game
        </button>
      </section>
    </div>
  )
}
