# AI Matchup Configuration Guide

This guide explains how to configure and run AI agent matchups using YAML configuration files.

## Quick Start

1. Copy the example config:
   ```
   cp ai-matchups.example.yaml ai-matchups.yaml
   ```
2. Edit `ai-matchups.yaml` to define the matchups you want.
3. Run:
   ```
   npm run ai:train -- --config ai-matchups.yaml
   ```

Or use the convenience script that points to the example file:

```
npm run ai:train:config
```

## Running Matchups

There are three ways to specify a config file:

| Method | Command |
|---|---|
| `--config` flag | `npm run ai:train -- --config path/to/config.yaml` |
| `AI_CONFIG` env var | `AI_CONFIG=path/to/config.yaml npm run ai:train` |
| Convenience script | `npm run ai:train:config` (uses `ai-matchups.example.yaml`) |

If no config file is provided, a set of built-in default matchups is used (random vs random, aggressive vs defensive, defensive vs aggressive, aggressive vs aggressive).

## YAML Configuration Reference

### Top-Level Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `numGames` | positive integer | No | `20` | Number of games to play per matchup. |
| `maxTurns` | positive integer | No | `500` | Maximum turns per game before it is declared a draw. |
| `outputDir` | string | No | `ai-output/` | Directory where results and reports are written. Resolved relative to the YAML file's location. |
| `matchups` | array | **Yes** | — | List of matchup definitions (at least one required). |

### Matchup Definitions

Each entry in `matchups` defines a pairing of two agents — `p1` and `p2`. Both fields are required.

Each agent can be specified in **shorthand** (strategy name string), **object with preset**, or **object with per-phase strategy**:

#### Shorthand Form

```yaml
matchups:
  - p1: random
    p2: aggressive
```

When using shorthand, the agent is automatically named `P1-<strategy>-<index>` / `P2-<strategy>-<index>` (e.g. `P1-random-1`).

#### Object Form (Preset Strategy)

```yaml
matchups:
  - p1:
      name: My-Custom-Agent
      strategy: defensive
    p2:
      name: The-Opponent
      strategy: aggressive
```

#### Object Form (Per-Phase Strategy)

```yaml
matchups:
  - p1:
      name: My-Custom-Agent
      strategy:
        setup: wide-spread
        opening: rush
        tactic: pick-heavy
    p2:
      name: The-Opponent
      strategy:
        setup: front-loaded
        opening: hold
        tactic: conservative
```

When using per-phase strategy, all three fields (`setup`, `opening`, `tactic`) are **required**.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | A custom display name for the agent. Used in output reports. Auto-generated if omitted. |
| `strategy` | string or object | **Yes** | Either a preset (`random`, `aggressive`, `defensive`) or an object with `setup`, `opening`, and `tactic` fields. |

You can mix shorthand, preset, and per-phase forms freely within the same file.

## Preset Strategies

Preset strategies are quick shorthands that use a fixed behavior for all phases. They are fully backward compatible with earlier configs.

### `random`

**Behavior:** On each action, the agent picks uniformly at random from all legal actions — moves and picks alike — with no preference. Setup placement is also random.

**When to use:** Baseline testing. Use this strategy for a control group to measure how much better other strategies perform compared to pure chance.

### `aggressive`

**Behavior:** Prioritizes capturing (picking) opponent pieces above all else. On each action:

1. **If any pick is available**, it selects a random valid pick — immediately capturing an opponent piece.
2. **Otherwise**, it prefers **forward moves** — moves that advance a piece closer to the opponent's goal row. Among forward moves, it selects the one that lands closest to the goal.
3. **If no forward moves exist**, it falls back to a random legal move.

**When to use:** Testing offensive pressure. This strategy will aggressively thin out the opponent's pieces and push toward the goal.

### `defensive`

**Behavior:** Prioritizes positional advancement while avoiding captures. On each action:

1. **If any forward move is available**, it selects a random forward move — advancing a piece toward the opponent's goal row.
2. **If no forward moves exist**, it falls back to a random legal move.
3. **Picks are used only as a last resort** — only if no moves (forward or otherwise) are available at all.

**When to use:** Testing a positional, avoidance-based approach. This strategy tries to reach the goal through movement rather than elimination.

---

## Per-Phase Strategies

Per-phase strategies give you granular control over each stage of the game. The agent's behavior is split into three phases:

1. **Setup** — how pieces are placed on the board during the setup phase.
2. **Opening** — how the agent plays during the opening of the play phase (while no pieces have been captured yet).
3. **Tactic** — how the agent plays for the remainder of the game (after the first capture).

### Setup Strategies

All setup strategies place the same types and counts of pieces (4 triangles, 3 squares, 2 circles). They differ in *where* pieces are placed within the valid setup zone.

#### `balanced`

Random placement on any valid spot. This is the default if no setup strategy is specified.

**Behavior:** Each piece is placed on a uniformly random valid spot with no positional preference.

#### `wide-spread`

Maximize the spread of pieces across the board.

**Behavior:** Each piece is placed on the valid spot that maximizes the total x-range plus y-range of all owned pieces. This produces a formation that covers as much of the setup zone as possible.

#### `clustered-narrow`

Cluster pieces in a narrow column.

**Behavior:** Each piece is placed on the valid spot closest in x-coordinate to the centroid of already-placed pieces (or the board center if no pieces are placed yet). This produces a tight vertical column of pieces.

#### `front-loaded`

Push pieces as close to the center line as possible.

**Behavior:** Each piece is placed on the valid spot whose y-coordinate is closest to the center line of the board. This positions all pieces at the front of the setup zone, minimizing the distance to the opponent's territory.

---

### Opening Strategies

Opening strategies control agent behavior during the play phase **before any piece has been captured**. Once a capture occurs, the agent switches to its tactic strategy.

#### `mixed-opening`

Random action selection (default opening behavior).

**Behavior:** On each action, the agent picks uniformly at random from all legal actions — both moves and picks.

#### `early-pick`

Prioritize captures from the start.

**Behavior:** If any pick action is available, the agent takes it. Otherwise, it makes a random move. This seeks to thin out the opponent immediately.

#### `rush`

Sprint toward the opponent's goal.

**Behavior:** The agent selects the forward move that advances furthest toward the opponent's goal row. If no forward moves are available, it falls back to a random move. Picks are ignored.

#### `hold`

Hold position and avoid advancing.

**Behavior:** The agent selects non-forward moves (lateral or backward). If only forward moves are available, it takes a random one as a fallback. Picks are ignored. This delays engagement and waits for the opponent to approach.

---

### Tactic Strategies

Tactic strategies control agent behavior during the play phase **after the first capture has occurred**. This is where the main body of the game takes place.

#### `movement-focused`

Prioritize forward movement, picks only as last resort.

**Behavior:** The agent prefers random forward moves. If no forward moves are available, it makes any random move. Picks are used only when no moves at all are available.

#### `pick-heavy`

Aggressively capture opponent pieces.

**Behavior:** If any pick action is available, the agent takes it. Otherwise, it selects the best forward move (closest to the goal). If no forward moves, it makes a random move. This keeps constant capture pressure.

#### `conservative`

Play cautiously with early turn ends.

**Behavior:** After using 1 action, the agent has a 40% chance of ending its turn early. When it does act, it prefers non-forward moves (lateral or backward). Picks are used only as a last resort. This produces slow, cautious play.

#### `no-play-actions`

End turn immediately every turn.

**Behavior:** The agent always ends its turn without taking any action. This is a fully passive strategy — useful as a control to measure the impact of doing nothing.

---

## Environment Variable Overrides

Environment variables override values in the YAML file. This is useful for quick one-off adjustments without editing the config.

| Variable | Overrides | Example |
|---|---|---|
| `NUM_GAMES` | `numGames` | `NUM_GAMES=5 npm run ai:train -- --config config.yaml` |
| `MAX_TURNS` | `maxTurns` | `MAX_TURNS=200 npm run ai:train -- --config config.yaml` |
| `OUTPUT_DIR` | `outputDir` | `OUTPUT_DIR=./my-results npm run ai:train -- --config config.yaml` |

**Precedence order** (highest to lowest):

1. Environment variables (`NUM_GAMES`, `MAX_TURNS`, `OUTPUT_DIR`)
2. YAML config values (`numGames`, `maxTurns`, `outputDir`)
3. Built-in defaults (`20`, `500`, `ai-output/`)

## Full Example

```yaml
# ai-matchups.yaml

numGames: 50
maxTurns: 800
outputDir: ai-output/experiment-1

matchups:
  # Baseline: random vs random
  - p1: random
    p2: random

  # Preset: aggression vs defense
  - p1: aggressive
    p2: defensive

  # Per-phase: spread setup, rush opening, movement tactic
  - p1:
      name: Spread-Rusher
      strategy:
        setup: wide-spread
        opening: rush
        tactic: movement-focused
    p2:
      name: Cluster-Picker
      strategy:
        setup: clustered-narrow
        opening: early-pick
        tactic: pick-heavy

  # Per-phase vs preset
  - p1:
      name: Turtle
      strategy:
        setup: front-loaded
        opening: hold
        tactic: conservative
    p2: aggressive

  # Front-loaded passive vs balanced mixed
  - p1:
      strategy:
        setup: front-loaded
        opening: mixed-opening
        tactic: no-play-actions
    p2:
      strategy:
        setup: balanced
        opening: rush
        tactic: movement-focused
```

## Output

Results are written to the configured `outputDir`. Each run produces:

- **Summary report** — win rates, draw rates, and aggregate statistics for each matchup.
- **Game logs** — detailed per-game action logs for replay and analysis.
- **Strategy analysis** — markdown report comparing strategy performance across all matchups.

## Validation

The config loader validates your YAML at startup and will fail with a descriptive error if:

- `matchups` is missing or empty.
- A preset strategy name is not one of `random`, `aggressive`, or `defensive`.
- A per-phase strategy has an invalid or missing `setup`, `opening`, or `tactic` value.
- `numGames` or `maxTurns` is not a positive integer.
- A matchup entry is missing `p1` or `p2`.
