# Live Multiplayer Implementation Plan

This plan translates the current single-device React implementation into a live multiplayer game with synchronized turns, authoritative validation, and reconnect support.

## 1) Current State Summary (Codebase Findings)

- The game currently runs entirely in client state inside `/src/App.tsx`.
- Core rules are already separated and reusable:
  - board geometry: `/src/game/board.ts`
  - constants/ranges: `/src/game/constants.ts`
  - rules/helpers: `/src/game/rules.ts`
  - move/pick validation: `/src/game/movement.ts`
  - shared types (piece/phase/player): `/src/game/types.ts`
- Rendering is cleanly separated in `/src/components/GameBoard.tsx`.
- Build tooling exists (`npm run build`) but no test runner is currently configured in `package.json`.

This separation makes it feasible to extract deterministic game transitions and run them on a server.

## 2) Target Multiplayer Capabilities

### Must-have

1. Create/join game rooms.
2. Two human players (`P1`, `P2`) connected simultaneously.
3. Server-authoritative actions:
   - setup placement
   - move
   - set pick
   - end turn early
   - reset/new game
4. Real-time state sync after each accepted action.
5. Turn enforcement and anti-cheat validation on server.
6. Basic reconnect: player can rejoin their active room/session.

### Should-have (near-term)

1. Spectator/read-only support.
2. Presence indicators and disconnect timeout handling.
3. Action history for debugging and dispute analysis.

## 3) Architecture Proposal

## Frontend (existing Vite + React app)

- Keep `GameBoard` as presentational.
- Introduce a thin multiplayer client layer:
  - `src/multiplayer/client.ts` (WebSocket transport)
  - `src/multiplayer/protocol.ts` (message types)
  - `src/multiplayer/session.ts` (room/player session token handling)
- Refactor `App.tsx` so local UI consumes a single `GameState` object received from server instead of mutating core state directly.

## Backend (new service)

- Node.js + TypeScript server with WebSocket support.
- In-memory game room manager for initial version.
- Authoritative game engine:
  - reuses or ports logic from `src/game/*`
  - applies events to state only after validation
- Emits state snapshots and action rejections to clients.

## Deployment Topology

1. Static frontend hosted separately (current Vite build output).
2. WebSocket game service behind HTTPS/WSS endpoint.
3. Optional Redis adapter for multi-instance scaling in Phase 2+.

## 4) Shared Domain Model Extraction

To prevent client/server rule drift, create shared modules (monorepo package or duplicated with strict sync in first step):

- `GameState`
  - phase, turn, setupPlayer, winner
  - pieces
  - actionsUsed, actedPieceIds
  - pickPointIds
- `GameAction` discriminated union
  - `PLACE_PIECE`
  - `SELECT_PIECE` (client-local only, not sent to server)
  - `MOVE_TO_SPOT`
  - `PICK_PIECE`
  - `END_TURN`
  - `RESET_GAME`
- `GameEvent` / server responses
  - `STATE_SYNC`
  - `ACTION_REJECTED`
  - `PLAYER_JOINED`
  - `PLAYER_LEFT`
  - `GAME_STARTED`
  - `GAME_FINISHED`

### Extraction sequence

1. Move pure transition logic from `App.tsx` into pure functions:
   - `applySetupPlacement(state, action)`
   - `applyMove(state, action)`
   - `applyPick(state, action)`
   - `applyEndTurn(state)`
2. Keep movement/rules modules pure and dependency-free.
3. Add deterministic state transition tests around these functions before wiring networking.

## 5) Networking Protocol (WebSocket)

## Client → Server

- `room:create { displayName }`
- `room:join { roomCode, displayName, reconnectToken? }`
- `game:action { roomCode, action, actionId, clientVersion }`
- `ping`

## Server → Client

- `room:created { roomCode, playerSlot, reconnectToken }`
- `room:joined { roomCode, playerSlot, state }`
- `game:state { state, version, lastActionId }`
- `game:error { actionId?, code, message }`
- `presence:update { players }`
- `pong`

### Protocol rules

- Every accepted action increments `version`.
- Server ignores duplicate `actionId` for idempotency.
- Client applies `game:state` only if `version` is newer.

## 6) Server Validation Rules

Server must re-run all rule checks currently performed client-side:

1. phase-gated actions (`setup`, `play`, `finished`)
2. turn ownership checks
3. per-turn action count limit (`MAX_MOVES_PER_TURN`)
4. one-action-per-piece-per-turn (`actedPieceIds`)
5. move target validity (`computeValidMoveTargets`)
6. pick target validity (`computeValidPickTargets`)
7. setup constraints and spacing rules
8. winner detection and phase transition to `finished`

Never trust client-calculated valid moves/picks.

## 7) State Persistence Strategy

## Phase 1 (minimal)

- In-memory room store with TTL cleanup.
- Reconnect by `roomCode + reconnectToken`.

## Phase 2

- Persist room snapshots + action log in Redis/Postgres.
- Resume games after server restart.

## 8) Frontend Refactor Plan

1. Introduce connection lifecycle UI states:
   - connecting, connected, disconnected, reconnecting
2. Keep local-only UI state:
   - selected piece
   - action mode toggle
   - transient hints
3. Replace direct state mutations in `App.tsx` with `sendAction(...)`.
4. Render server-synchronized state as source of truth.
5. Add user-friendly errors when server rejects actions.

## 9) Incremental Milestones

### Milestone A: Deterministic Engine

- Extract pure game transition functions from `App.tsx`.
- Add unit tests for setup/play/pick/win transitions.

### Milestone B: Single-Process Multiplayer

- Add WebSocket server.
- Implement room create/join and server-authoritative actions.
- Frontend connects and receives synchronized state.

### Milestone C: Reconnect + Presence

- Reconnect tokens, disconnect timeout, presence updates.

### Milestone D: Hardening

- Action idempotency and version conflict handling.
- Rate limiting and basic abuse prevention.
- Structured logging and room diagnostics.

### Milestone E: Scale/Persistence (optional)

- External state store and multi-instance support.

## 10) Testing Plan

Because no test framework is currently configured, introduce one in the multiplayer implementation branch when coding begins.

### Unit tests (engine)

- valid/invalid setup placement
- valid/invalid move and pick actions
- turn rotation and action cap enforcement
- pick lock behavior and blocked pick points
- win detection on reaching far square row

### Integration tests (server)

- two clients join same room and receive identical state
- out-of-turn action rejected
- duplicate `actionId` handled idempotently
- reconnect resumes correct player slot/state

### E2E smoke tests (client+server)

- full game path from setup to win
- network drop + reconnect during turn

## 11) Security and Fairness Checklist

- Server-authoritative validation for all actions.
- Input validation on all protocol payloads.
- Per-room and per-connection rate limits.
- Reject malformed IDs and unknown spot IDs.
- Keep reconnect tokens unguessable and short-lived.
- Never expose hidden server metadata in client payloads.

## 12) Observability and Operations

- Structured logs with roomCode/actionId/version.
- Metrics:
  - active rooms
  - active sockets
  - action reject rate
  - reconnect success rate
- Crash-safe shutdown hook for graceful room cleanup.

## 13) Rollout Plan

1. Ship behind `VITE_MULTIPLAYER_ENABLED` feature flag.
2. Internal dogfood with small number of rooms.
3. Enable for a percentage of users.
4. Full rollout after stability targets are met.

## 14) Risks and Mitigations

1. **Rule divergence (client vs server)**  
   Mitigation: shared pure engine module + comprehensive transition tests.

2. **Desync under packet delay/reorder**  
   Mitigation: server versioning + idempotent action IDs + full state sync.

3. **Session loss on refresh/disconnect**  
   Mitigation: reconnect token persisted in local storage with expiration.

4. **Scaling constraints with in-memory rooms**  
   Mitigation: clearly scoped Phase 2 persistence adapter.

## 15) Clarifying Questions

1. Should live multiplayer support only private room codes initially, or also public matchmaking?
2. Do we need spectator mode in v1, or can it be deferred?
3. Is cross-device reconnect (new device/browser) required in v1, or same-device refresh only?
4. Should games persist across server restarts in v1, or is volatile in-memory acceptable?
5. What is the expected maximum concurrent rooms/users for initial launch?
6. Do we need turn timers/auto-forfeit for disconnected or idle players?
7. Should move history/replay be user-visible in v1 or internal-only for debugging?
