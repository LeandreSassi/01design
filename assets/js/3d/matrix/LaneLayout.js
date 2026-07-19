import { MATRIX, LANES } from '../config.js';

// Small positional spread for projects sharing a cell, so they read as
// distinct volumes rather than one coincident blob. Overlap between
// different projects is fine now — the global scale slider (see
// ui/ScaleControl.js) is what actually controls how much they fuse — this
// just keeps each one's own centre visually distinct at low scale.
function evenlySpaced(count, maxOffset) {
    if (count <= 1) return [0];
    const step = (2 * maxOffset) / (count - 1);
    return Array.from({ length: count }, (_, i) => -maxOffset + i * step);
}

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function permutationStep(count, skip) {
    for (let s = 2; s < count; s++) if (s !== skip && gcd(s, count) === 1) return s;
    return 1;
}

export function laneSlot(laneIndex, laneCount) {
    if (laneCount <= 1) return { offset: [0, 0, 0] };

    const maxOffset = MATRIX.spacing * LANES.maxOffsetFraction;
    const values = evenlySpaced(laneCount, maxOffset);
    const stepY = permutationStep(laneCount, 1);
    const stepZ = permutationStep(laneCount, stepY);

    return {
        offset: [
            values[laneIndex],
            values[(laneIndex * stepY) % laneCount],
            values[(laneIndex * stepZ) % laneCount]
        ]
    };
}

/** Applies a lane's 3D offset to every one of a project's box specs. */
export function applyOffset(specs, offset) {
    return specs.map(spec => ({
        size: spec.size,
        off: [spec.off[0] + offset[0], spec.off[1] + offset[1], spec.off[2] + offset[2]]
    }));
}
