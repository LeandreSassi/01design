// Groups sorted category indices into contiguous runs, e.g. [0,1,3,4] -> [[0,1],[3,4]].
// Shared by BoxSpecBuilder (what geometry to draw) and Footprint (what cells
// that geometry actually occupies) so the two can never disagree.
export function contiguousRuns(sortedIndices) {
    if (!sortedIndices.length) return [];
    const runs = [];
    let start = sortedIndices[0], prev = sortedIndices[0];
    for (let k = 1; k < sortedIndices.length; k++) {
        if (sortedIndices[k] === prev + 1) { prev = sortedIndices[k]; continue; }
        runs.push([start, prev]);
        start = prev = sortedIndices[k];
    }
    runs.push([start, prev]);
    return runs;
}
