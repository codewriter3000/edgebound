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
| `strategy` | string or object | **Yes** | Either a preset (`random`, `aggressive`, `defensive`, `learning`) or an object with `setup`, `opening`, and `tactic` fields. |
| `weightsFile` | string | Only for `learning` | Path to a JSON weights file (created automatically if missing). Required when strategy is `learning`. |

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

### `learning`

**Behavior:** Uses a learned weights file to probabilistically select per-phase strategies (setup, opening, tactic) for each game. Before every game, the agent samples a strategy combination weighted by past performance. After each game, winning strategies are reinforced (weights increase by +0.1) and losing strategies are penalized (weights decrease by -0.05, with a floor of 0.05). Over hundreds of games, the agent converges toward strategy combinations that win more often.

**Requires:** A `weightsFile` path on the agent config. If the file doesn't exist yet, uniform weights are created automatically. After training, the updated weights are saved back to the same file.

**YAML syntax:**

```yaml
matchups:
  - p1:
      name: Learner
      strategy: learning
      weightsFile: weights/learner-p1.json
    p2: aggressive
```

**weightsFile format (JSON):**

The weights file is a JSON object that the system creates and updates automatically. You don't need to write it by hand — just point `weightsFile` at a path and the system will create it on the first run. Here's what it looks like after training:

```json
{
  "version": 1,
  "gamesPlayed": 100,
  "weights": {
    "setup": {
      "wide-spread": 1.2,
      "clustered-narrow": 0.85,
      "front-loaded": 1.05,
      "balanced": 0.9
    },
    "opening": {
      "early-pick": 1.1,
      "rush": 1.3,
      "hold": 0.6,
      "mixed-opening": 1.0
    },
    "tactic": {
      "no-play-actions": 0.05,
      "pick-heavy": 1.15,
      "conservative": 0.7,
      "movement-focused": 1.1
    }
  }
}
```

Higher weights mean the agent is more likely to select that strategy. All weights start at 1.0 with uniform probability. The minimum weight is 0.05 — no strategy is ever fully eliminated.

**When to use:** When you want the system to discover which strategy combinations work best against a particular opponent. Run the same config multiple times — each run loads the previous weights, plays more games, and saves updated weights. Over time the agent learns to favor winning strategies.

**Multi-run training loop:**

```bash
# Each run loads the existing weights, plays games, reinforces, and saves
npm run ai:train -- ai-matchups.yaml   # run 1: starts from uniform weights
npm run ai:train -- ai-matchups.yaml   # run 2: loads run-1 weights, refines
npm run ai:train -- ai-matchups.yaml   # run 3: loads run-2 weights, refines further
```

After training, the output directory includes a `<agent-name>-weights-report.md` showing the current weight distribution.

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

  # Learning agent: discovers best strategies over repeated runs
  - p1:
      name: Learner
      strategy: learning
      weightsFile: weights/learner.json
    p2: aggressive
```

## Output

Results are written to the configured `outputDir`. Each run produces:

- **Summary report** — win rates, draw rates, and aggregate statistics for each matchup.
- **Game logs** — detailed per-game action logs for replay and analysis.
- **Strategy analysis** — markdown report comparing strategy performance across all matchups.

## How the AI Learning Pipeline Works

The AI system uses a **self-play → analysis → report** pipeline that plays many games between configurable agents, classifies the emergent behavior patterns, and produces statistical reports. The `learning` strategy adds lightweight reinforcement on top: it adjusts per-phase strategy weights based on wins and losses, so that over repeated runs the agent converges toward effective strategy combinations.

### Pipeline Stages

```
YAML Config → Self-Play Engine → Game Logs → Pattern Analysis → Reports
```

**1. Self-Play Engine** (`selfplay.ts`)

For each matchup defined in your YAML config, the engine plays `numGames` full games:

- A fresh game state is created for each game.
- On every turn, the current player's agent selects an action based on its configured strategy (preset or per-phase).
- The action is validated against the game engine. If rejected, the agent retries (up to 10 consecutive rejections before the game is aborted).
- Every accepted action is recorded as a `MoveLogEntry` containing the player, action, and resulting game state.
- A game ends when a player wins, the turn limit (`maxTurns`) is reached (draw), or the agent cannot produce a valid action.

**2. Game Logger** (`logger.ts`)

Each game produces a `GameLog` containing:

- The game ID and which agents played.
- A full move-by-move history with the complete game state after each action.
- The winner (or `null` for a draw).
- Total move count and timestamps.

These logs are the raw data that all downstream analysis operates on.

**3. Pattern Analysis** (`analysis.ts`)

The analyzer reads the game logs and classifies emergent behavior into three categories by examining what actually happened in each game — not what the agent was told to do, but what patterns its actions produced:

- **Setup patterns** — Based on the x-spread and y-spread of each player's placed pieces:
  - `wide-spread`: x-spread ≥ 6 and y-spread ≥ 3
  - `clustered-narrow`: x-spread ≤ 3
  - `front-loaded`: y-spread ≤ 2
  - `balanced`: everything else

- **Opening patterns** — Based on the first 8 play-phase actions (4 per player):
  - `early-pick`: any capture occurred in the opening moves
  - `rush`: all moves were forward advances
  - `hold`: no moves were forward advances
  - `mixed-opening`: a mix of forward and non-forward moves, no captures

- **Tactic patterns** — Based on the full play-phase action distribution:
  - `pick-heavy`: captures > 30% of move count
  - `conservative`: end-turns > 30% of total actions
  - `no-play-actions`: zero play-phase actions taken
  - `movement-focused`: everything else

Each pattern is tracked with its **frequency** (how many games it appeared in) and **win rate** (what percentage of games with that pattern resulted in a win for that player).

**4. Assessment & Recommendations**

The analyzer also produces high-level assessments:

- **First-player advantage** — Compares P1 and P2 win rates and flags imbalances greater than 5%.
- **Solvability assessment** — Evaluates draw rate and game length to estimate whether the game has strategic depth or tends toward stalemates.
- **Rule change recommendations** — Automatically suggests concrete rule changes when it detects problems like high first-player advantage (>15%), excessive draw rate (>40%), very long games (>300 avg moves), or very short decisive games (<30 avg moves with <10% draws).

**5. Strategy Report** (`strategy-tracker.ts`)

For each matchup, the strategy tracker generates a markdown report that separates patterns into:

- **Strategies that work** — Patterns with >50% win rate appearing in at least 2 games.
- **Strategies that don't work** — Patterns with <40% win rate appearing in at least 2 games.
- **Game balance & solvability** — The solvability assessment, first-player advantage analysis, and rule change recommendations.

All per-matchup reports plus an overall summary are combined into a single `STRATEGY_REPORT.md` in the output directory.

### Reading the Output

After a training run, the output directory contains:

```
ai-output/
├── STRATEGY_REPORT.md              ← Overall summary across all matchups
├── matchup-1-random-vs-aggressive/
│   ├── results.md                   ← Win/loss/draw summary
│   ├── game-logs.md                 ← Full move-by-move logs
│   └── analysis.md                  ← Pattern analysis + recommendations
├── matchup-2-defensive-vs-aggressive/
│   ├── results.md
│   ├── game-logs.md
│   └── analysis.md
└── ...
```

- Start with `STRATEGY_REPORT.md` for a high-level view of which strategies win and which don't.
- Dive into a matchup's `analysis.md` to see pattern breakdowns, win rates, and rule change suggestions.
- Use `game-logs.md` to replay individual games move-by-move if you need to understand *why* a pattern emerged.

### Key Insight

The per-phase strategy names (`wide-spread`, `rush`, `pick-heavy`, etc.) are shared between the **agent strategies** (what you tell an agent to do) and the **analysis patterns** (what the analyzer detects after the fact). This means you can:

1. Run a baseline experiment with preset strategies (e.g. `random` vs `aggressive`).
2. Read the analysis to see which emergent patterns correlate with winning.
3. Build a custom per-phase agent that intentionally uses those winning patterns.
4. Run another experiment to see if deliberately adopting those patterns improves results.

This iterate-and-refine loop is the core of the AI learning workflow.

## Validation

The config loader validates your YAML at startup and will fail with a descriptive error if:

- `matchups` is missing or empty.
- A preset strategy name is not one of `random`, `aggressive`, or `defensive`.
- A per-phase strategy has an invalid or missing `setup`, `opening`, or `tactic` value.
- `numGames` or `maxTurns` is not a positive integer.
- A matchup entry is missing `p1` or `p2`.
