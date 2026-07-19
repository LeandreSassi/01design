import { contiguousRuns } from './Runs.js';

// Computes every grid cell a project's shape actually occupies — not just its
// primary cell, but every cell covered by a stretched run AND every cell a
// bridge passes over. This is what conflict detection is based on: two
// projects that never share a footprint cell can never physically intersect.
export function computeFootprint(members) {
    // per-axis: every index covered by a run or a bridge passthrough
    const axisCells = members.map(sortedIndices => {
        const runs = contiguousRuns(sortedIndices);
        const cells = new Set();
        runs.forEach(([a, b]) => { for (let i = a; i <= b; i++) cells.add(i); });
        for (let r = 0; r < runs.length - 1; r++) {
            for (let i = runs[r][1] + 1; i < runs[r + 1][0]; i++) cells.add(i);
        }
        return [...cells];
    });

    const footprint = [];
    axisCells[0].forEach(x => axisCells[1].forEach(y => axisCells[2].forEach(z => {
        footprint.push(`${x},${y},${z}`);
    })));
    return footprint;
}
