import { GRID_SIZE, LATTICE_MAX } from './constants';
import { SPOT_BY_ID } from './board';
export function otherPlayer(player) {
    return player === 'P1' ? 'P2' : 'P1';
}
function getZoneRow(spot) {
    if (spot.y % 2 === 1) {
        return (spot.y - 1) / 2;
    }
    return spot.y / 2 - 0.5;
}
function canPlaceOnHalf(spot, player) {
    const row = getZoneRow(spot);
    return player === 'P1' ? row >= GRID_SIZE / 2 : row <= GRID_SIZE / 2 - 1;
}
export function isEdgeSpot(spot) {
    return (spot.x === 0 ||
        spot.x === LATTICE_MAX ||
        spot.y === 0 ||
        spot.y === LATTICE_MAX);
}
function isCenterLineSpot(spot) {
    return spot.y === LATTICE_MAX / 2;
}
export function canPlaceInSetup(spot, player) {
    if (isEdgeSpot(spot) || isCenterLineSpot(spot)) {
        return false;
    }
    return canPlaceOnHalf(spot, player);
}
export function isPathClear(origin, target, occupancy, blockedPointIds) {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 1; i < steps; i += 1) {
        const checkId = `${origin.x + stepX * i}-${origin.y + stepY * i}`;
        if (occupancy.has(checkId) || blockedPointIds.has(checkId)) {
            return false;
        }
    }
    return true;
}
export function hasRequiredSetupSpacing(spot, pieces) {
    return pieces.every((piece) => {
        const otherSpot = SPOT_BY_ID.get(piece.spotId);
        if (otherSpot == null) {
            return true;
        }
        const dx = spot.x - otherSpot.x;
        const dy = spot.y - otherSpot.y;
        const distance = Math.hypot(dx, dy);
        return distance >= 2;
    });
}
export function pieceGlyph(type) {
    if (type === 'triangle') {
        return '▲';
    }
    if (type === 'square') {
        return '■';
    }
    return '●';
}
export function typeLabel(type) {
    if (type === 'triangle') {
        return 'Triangle';
    }
    if (type === 'square') {
        return 'Square';
    }
    return 'Circle';
}
