# Movement Rules

This document describes the current movement and pick behavior implemented in the game.

## Board Point Types

- `square`: center of a board square
- `line`: midpoint point on a grid line
- `corner`: lattice corner point

## Turn and Action Rules

- Each player has up to **4 actions per turn**.
- A piece can take **at most one action per turn**.
- Locked pieces (pieces involved in picks) cannot act.

## Triangle Movement

Triangles can move in all 8 compass directions.

- Full step: 1 space (`2` lattice units)
- Half step: 1/2 space (`1` lattice unit)

Triangle endpoints may be `square`, `line`, or `corner` points if the target is valid and unobstructed.

## Square and Circle Movement

### From square-center origin

Squares and circles can move in all 8 directions.

- Square range: 1 or 2 spaces
- Circle range: 1, 2, or 3 spaces

Endpoints must be square centers.

### From line/corner origin (edge-style mapping)

Squares and circles use the edge mapping candidates, ending on square centers only.

- Uses odd-length transitions (`2n + 1` lattice delta) for each step distance.
- Generates orthogonal and skewed diagonal-like transitions for horizontal and vertical line origins.

## Edge Restrictions

- Squares and circles cannot land on edge points unless the destination contains an enemy piece and the move creates a pick.
- Triangles are not subject to that edge landing restriction.

## Picks

A pick can be created in two ways:

1. Move mode: moving onto an enemy piece.
2. Pick mode: selecting a valid enemy target.

When a pick is created:

- Both pieces become locked permanently.
- The pick point is stored as a blocked point.

## Pick Targeting Rules

### Square and Circle picks

- Orthogonal picks within piece pick range.
- 45-degree diagonal picks within piece pick range.
- Current configured pick ranges:
  - Square: 2 spaces
  - Circle: 3 spaces

### Triangle picks

Triangle can pick any enemy within 1 full space in any direction/angle:

- Euclidean distance from triangle to target must be `> 0` and `<= 2` lattice units.

## Blocking and Pathing

- Moves and picks must have a clear path.
- Traversal is blocked by:
  - occupied points
  - blocked pick points

## Same-team Spacing Constraint

- A non-pick move must keep same-team pieces at least 1 full space apart.
- This spacing exception is allowed when a move results in a pick.

## Setup Constraints (related)

- Setup placement is on the player's half only.
- No corner, center-line, or outer-edge setup placement.
- Setup spacing enforces minimum same-team distance of 1 full space.
