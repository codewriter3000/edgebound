import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GameBoard from './components/GameBoard'
import {
  MAX_MOVES_PER_TURN,
  PIECE_LIMITS,
  SHAPES,
} from './game/constants'
import { SPOT_BY_ID } from './game/board'
import {
  canPlaceInSetup,
  hasRequiredSetupSpacing,
  typeLabel,
} from './game/rules'
import {
  buildOccupancyMap,
  computeValidMoveTargets,
  computeValidPickTargets,
} from './game/movement'
import {
  applyGameAction,
  createInitialGameState,
  type GameAction,
} from './game/engine'
import type { PieceType, Player, Spot } from './game/types'
import { MultiplayerClient, type ConnectionStatus } from './multiplayer/client'
import type { PresencePlayer } from './multiplayer/protocol'
import { clearSession, loadSession, saveSession } from './multiplayer/session'

let actionCounter = 0
function nextActionId(): string {
  actionCounter += 1
  return `${Date.now()}-${actionCounter}`
}

export default function App() {
  const multiplayerEnabled = import.meta.env.VITE_MULTIPLAYER_ENABLED === 'true'
  const multiplayerUrl = import.meta.env.VITE_MULTIPLAYER_URL ?? 'ws://127.0.0.1:8787'

  const [gameState, setGameState] = useState(createInitialGameState)
  const [stateVersion, setStateVersion] = useState(0)
  const [selectedType, setSelectedType] = useState<PieceType>('triangle')
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null)
  const [actionMode, setActionMode] = useState<'move' | 'pick'>('move')
  const [lastError, setLastError] = useState<string | null>(null)

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [displayName, setDisplayName] = useState('Player')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [playerSlot, setPlayerSlot] = useState<Player | null>(null)
  const [presence, setPresence] = useState<PresencePlayer[]>([])

  const clientRef = useRef<MultiplayerClient | null>(null)
  const stateVersionRef = useRef(0)
  const displayNameRef = useRef(displayName)

  useEffect(() => {
    stateVersionRef.current = stateVersion
  }, [stateVersion])
  useEffect(() => {
    displayNameRef.current = displayName
  }, [displayName])

  const handleStateMessage = useCallback((state: ReturnType<typeof createInitialGameState>, version: number) => {
    if (version <= stateVersionRef.current) {
      return
    }

    setGameState(state)
    setStateVersion(version)
    setLastError(null)
  }, [])

  useEffect(() => {
    if (!multiplayerEnabled) {
      return
    }

    const client = new MultiplayerClient({
      url: multiplayerUrl,
      onStatus: (status) => {
        setConnectionStatus(status)

        if (status === 'connected') {
          setLastError(null)
          const saved = loadSession()
          if (saved.roomCode != null && saved.reconnectToken != null) {
            setDisplayName(saved.playerName ?? 'Player')
            client.joinRoom(saved.roomCode, saved.playerName ?? 'Player', saved.reconnectToken)
          }
        }
      },
      onRoom: ({ roomCode: joinedCode, playerSlot, reconnectToken, state, version }) => {
        setRoomCode(joinedCode)
        setJoinCodeInput(joinedCode)
        setPlayerSlot(playerSlot)
        setGameState(state)
        setStateVersion(version)
        setSelectedPieceId(null)
        setActionMode('move')
        setLastError(null)
        const currentName = displayNameRef.current
        const nameToStore = currentName.trim().length > 0 ? currentName : 'Player'
        saveSession(joinedCode, reconnectToken, nameToStore)
      },
      onState: (state, version) => handleStateMessage(state, version),
      onPresence: (players) => {
        setPresence(players)
      },
      onError: (message) => {
        setLastError(message)
      },
    })

    clientRef.current = client
    client.connect()

    return () => {
      client.disconnect()
      clientRef.current = null
    }
  }, [handleStateMessage, multiplayerEnabled, multiplayerUrl])

  useEffect(() => {
    if (selectedPieceId == null) {
      return
    }

    const selectedExists = gameState.pieces.some((piece) => piece.id === selectedPieceId)
    if (!selectedExists) {
      setSelectedPieceId(null)
    }
  }, [gameState.pieces, selectedPieceId])

  const occupancy = useMemo(() => buildOccupancyMap(gameState.pieces), [gameState.pieces])
  const blockedPickPointIds = useMemo(() => new Set(gameState.pickPointIds), [gameState.pickPointIds])

  const setupCounts = useMemo(() => {
    const counts = {
      P1: { triangle: 0, square: 0, circle: 0 },
      P2: { triangle: 0, square: 0, circle: 0 },
    }

    gameState.pieces.forEach((piece) => {
      counts[piece.owner][piece.type] += 1
    })

    return counts
  }, [gameState.pieces])

  const activePlayer = gameState.phase === 'setup' ? gameState.setupPlayer : gameState.turn
  const canControlNow = !multiplayerEnabled || (playerSlot != null && playerSlot === activePlayer)

  const selectablePieces = useMemo(() => {
    if (
      gameState.phase !== 'play' ||
      gameState.actionsUsed >= MAX_MOVES_PER_TURN ||
      !canControlNow
    ) {
      return new Set<string>()
    }

    const ids = new Set<string>()
    gameState.pieces.forEach((piece) => {
      if (
        piece.owner === gameState.turn &&
        !piece.locked &&
        !gameState.actedPieceIds.includes(piece.id)
      ) {
        ids.add(piece.id)
      }
    })

    return ids
  }, [canControlNow, gameState])

  const selectedPiece =
    selectedPieceId == null
      ? null
      : gameState.pieces.find((piece) => piece.id === selectedPieceId) ?? null

  const validMoveTargets = useMemo(() => {
    return computeValidMoveTargets({
      phase: gameState.phase,
      actionMode,
      actionsUsed: gameState.actionsUsed,
      turn: gameState.turn,
      selectedPiece,
      actedPieceIds: gameState.actedPieceIds,
      pieces: gameState.pieces,
      occupancy,
      blockedPickPointIds,
    })
  }, [actionMode, blockedPickPointIds, gameState, occupancy, selectedPiece])

  const validPickTargets = useMemo(() => {
    return computeValidPickTargets({
      phase: gameState.phase,
      actionMode,
      turn: gameState.turn,
      selectedPiece,
      actedPieceIds: gameState.actedPieceIds,
      pieces: gameState.pieces,
      occupancy,
      blockedPickPointIds,
    })
  }, [actionMode, blockedPickPointIds, gameState, occupancy, selectedPiece])

  const selectedMoveHints = useMemo(() => {
    if (gameState.phase !== 'play' || selectedPiece == null) {
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
  }, [gameState.phase, selectedPiece, validMoveTargets])

  function allPlacedFor(player: Player): boolean {
    const counts = setupCounts[player]
    return SHAPES.every((shape) => counts[shape] === PIECE_LIMITS[shape])
  }

  function applyLocalAction(action: GameAction): void {
    const actor = gameState.phase === 'setup' ? gameState.setupPlayer : gameState.turn
    const result = applyGameAction(gameState, actor, action)
    if (!result.accepted) {
      setLastError(result.error ?? 'Action rejected')
      return
    }

    setGameState(result.state)
    setSelectedPieceId(null)
    setLastError(null)
  }

  function sendAction(action: GameAction): void {
    if (!multiplayerEnabled) {
      applyLocalAction(action)
      return
    }

    if (roomCode == null) {
      setLastError('Create or join a room first.')
      return
    }

    const client = clientRef.current
    if (client == null) {
      setLastError('Multiplayer client unavailable.')
      return
    }

    client.sendAction(roomCode, action, nextActionId(), stateVersion)
  }

  function handleSpotClick(spot: Spot) {
    if (gameState.phase === 'setup') {
      if (!canControlNow) {
        return
      }

      if ((occupancy.get(spot.id)?.length ?? 0) > 0 || !canPlaceInSetup(spot, gameState.setupPlayer)) {
        return
      }

      const ownPieces = gameState.pieces.filter((piece) => piece.owner === gameState.setupPlayer)
      if (!hasRequiredSetupSpacing(spot, ownPieces)) {
        return
      }

      if (setupCounts[gameState.setupPlayer][selectedType] >= PIECE_LIMITS[selectedType]) {
        return
      }

      sendAction({
        type: 'PLACE_PIECE',
        pieceType: selectedType,
        spotId: spot.id,
      })

      return
    }

    if (
      gameState.phase !== 'play' ||
      selectedPiece == null ||
      actionMode !== 'move' ||
      !canControlNow
    ) {
      return
    }

    if (gameState.actionsUsed >= MAX_MOVES_PER_TURN || !validMoveTargets.has(spot.id)) {
      return
    }

    sendAction({
      type: 'MOVE_TO_SPOT',
      pieceId: selectedPiece.id,
      targetSpotId: spot.id,
    })
  }

  function handlePieceClick(piece: { id: string; owner: Player; spotId: string }) {
    if (gameState.phase !== 'play' || !canControlNow) {
      return
    }

    if (selectedPiece == null) {
      if (selectablePieces.has(piece.id)) {
        setSelectedPieceId(piece.id)
      }
      return
    }

    if (piece.owner === gameState.turn) {
      if (selectablePieces.has(piece.id)) {
        setSelectedPieceId((prev) => (prev === piece.id ? null : piece.id))
      }
      return
    }

    if (actionMode === 'pick') {
      if (!validPickTargets.has(piece.id)) {
        return
      }

      sendAction({
        type: 'PICK_PIECE',
        pieceId: selectedPiece.id,
        targetPieceId: piece.id,
      })
      return
    }

    const targetSpot = SPOT_BY_ID.get(piece.spotId)
    if (targetSpot == null || !validMoveTargets.has(targetSpot.id)) {
      return
    }

    sendAction({
      type: 'MOVE_TO_SPOT',
      pieceId: selectedPiece.id,
      targetSpotId: targetSpot.id,
    })
  }

  function endTurnEarly() {
    if (gameState.phase !== 'play' || !canControlNow) {
      return
    }

    sendAction({ type: 'END_TURN' })
  }

  function resetGame() {
    if (multiplayerEnabled && roomCode != null) {
      sendAction({ type: 'RESET_GAME' })
      return
    }

    setGameState(createInitialGameState())
    setSelectedType('triangle')
    setSelectedPieceId(null)
    setActionMode('move')
    setLastError(null)
  }

  function createRoom() {
    const client = clientRef.current
    if (!multiplayerEnabled || client == null) {
      return
    }

    clearSession()
    client.createRoom(displayName)
  }

  function joinRoom() {
    const client = clientRef.current
    if (!multiplayerEnabled || client == null) {
      return
    }

    const code = joinCodeInput.trim().toUpperCase()
    if (code.length === 0) {
      setLastError('Enter a room code.')
      return
    }

    client.joinRoom(code, displayName)
  }

  function getSpotClass(spot: Spot): string {
    const classes = ['spot', spot.kind]

    if (gameState.phase === 'setup') {
      const ownPieces = gameState.pieces.filter((piece) => piece.owner === gameState.setupPlayer)
      if (
        canPlaceInSetup(spot, gameState.setupPlayer) &&
        (occupancy.get(spot.id)?.length ?? 0) === 0 &&
        hasRequiredSetupSpacing(spot, ownPieces)
      ) {
        classes.push('setup-valid')
      }
    }

    if (gameState.phase === 'play' && actionMode === 'move' && validMoveTargets.has(spot.id)) {
      classes.push('move-target')
    }

    return classes.join(' ')
  }

  function canRenderSetupSpot(spot: Spot): boolean {
    const ownPieces = gameState.pieces.filter((piece) => piece.owner === gameState.setupPlayer)
    return (
      canPlaceInSetup(spot, gameState.setupPlayer) &&
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

      {multiplayerEnabled && (
        <section className="panel">
          <h2>Multiplayer</h2>
          <p>
            Connection: <strong>{connectionStatus}</strong>
          </p>
          <div className="button-group">
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Display name"
            />
            <button type="button" onClick={createRoom}>
              Create Room
            </button>
            <input
              value={joinCodeInput}
              onChange={(event) => setJoinCodeInput(event.target.value.toUpperCase())}
              placeholder="Room code"
            />
            <button type="button" onClick={joinRoom}>
              Join Room
            </button>
          </div>
          {roomCode != null && (
            <p>
              Room: <strong>{roomCode}</strong> | You are <strong>{playerSlot ?? 'observer'}</strong>
            </p>
          )}
          {presence.length > 0 && (
            <p>
              Players:{' '}
              {presence
                .map((player) => `${player.slot} ${player.displayName}${player.connected ? '' : ' (offline)'}`)
                .join(' | ')}
            </p>
          )}
        </section>
      )}

      <section className="panel-row">
        <div className="panel">
          <h2>Status</h2>
          {gameState.phase === 'setup' && (
            <p>
              Setup: <strong>{gameState.setupPlayer}</strong> places pieces on their half.
            </p>
          )}
          {gameState.phase === 'play' && (
            <p>
              Turn: <strong>{gameState.turn}</strong> ({gameState.actionsUsed}/{MAX_MOVES_PER_TURN} actions used)
            </p>
          )}
          {gameState.phase === 'finished' && gameState.winner != null && (
            <p>
              Winner: <strong>{gameState.winner}</strong>
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

      {gameState.phase === 'setup' && (
        <section className="controls panel">
          <h2>Setup Controls</h2>
          <div className="button-group">
            {SHAPES.map((shape) => {
              const disabled =
                setupCounts[gameState.setupPlayer][shape] >= PIECE_LIMITS[shape] ||
                allPlacedFor(gameState.setupPlayer) ||
                !canControlNow
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

      {gameState.phase === 'play' && (
        <>
          <section className="controls panel">
            <h2>Turn Controls</h2>
            <div className="button-group">
              <button
                type="button"
                className={actionMode === 'move' ? 'active' : ''}
                disabled={!canControlNow}
                onClick={() => setActionMode('move')}
              >
                Move
              </button>
              <button
                type="button"
                className={actionMode === 'pick' ? 'active' : ''}
                disabled={!canControlNow}
                onClick={() => setActionMode('pick')}
              >
                Set Pick
              </button>
              <button type="button" disabled={!canControlNow} onClick={endTurnEarly}>
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

      {lastError != null && (
        <section className="panel">
          <p>{lastError}</p>
        </section>
      )}

      <GameBoard
        phase={gameState.phase}
        pieces={gameState.pieces}
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
