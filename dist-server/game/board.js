import { LATTICE_MAX } from './constants';
function generateSpots() {
    const spots = [];
    for (let y = 0; y <= LATTICE_MAX; y += 1) {
        for (let x = 0; x <= LATTICE_MAX; x += 1) {
            const kind = x % 2 === 1 && y % 2 === 1
                ? 'square'
                : x % 2 === 0 && y % 2 === 0
                    ? 'corner'
                    : 'line';
            spots.push({ id: `${x}-${y}`, x, y, kind });
        }
    }
    return spots;
}
export const ALL_SPOTS = generateSpots();
export const SPOT_BY_ID = new Map(ALL_SPOTS.map((spot) => [spot.id, spot]));
