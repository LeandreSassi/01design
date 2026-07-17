// Turns a project's per-axis "member row" lists into a list of axis-aligned
// box specs ({ size:[x,y,z], off:[x,y,z] }, offsets relative to the project's
// primary cell). Pure math — no three.js.
//
// Rule: contiguous member rows on one axis melt into a single stretched box.
// A gap between runs gets a cube-wide bridge slab, thin in the perpendicular
// direction, flush against the tops (front face for the vertical/Y axis).
export class BoxSpecBuilder {
    constructor({ cubeSize, spacing, connectorSize, bridgeBite }) {
        this.cubeSize = cubeSize;
        this.spacing = spacing;
        this.connector = connectorSize;
        this.bite = bridgeBite;
    }

    /**
     * @param {number[]} prims  primary [ix, iy, iz] of this project
     * @param {number[][]} members  per-axis sorted member indices, e.g. [[0,2],[1],[0]]
     * @returns {{size:number[], off:number[]}[]}
     */
    build(prims, members) {
        const specs = [];
        let primaryDrawn = false;

        [0, 1, 2].forEach(dim => {
            const runs = this._contiguousRuns(members[dim]);
            const prim = prims[dim];

            runs.forEach(([a, b]) => {
                const isPlainPrimaryCell = a === b && a === prim;
                if (isPlainPrimaryCell) {
                    if (primaryDrawn) return;   // only emit the bare primary cell once
                }
                specs.push(this._runBox(dim, a, b, prim));
                if (a <= prim && prim <= b) primaryDrawn = true;
            });

            for (let r = 0; r < runs.length - 1; r++) {
                specs.push(this._bridge(dim, runs[r][1], runs[r + 1][0], prim));
            }
        });

        return specs;
    }

    _contiguousRuns(sortedIndices) {
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

    _runBox(dim, a, b, prim) {
        const size = [this.cubeSize, this.cubeSize, this.cubeSize];
        size[dim] = (b - a) * this.spacing + this.cubeSize;
        const off = [0, 0, 0];
        off[dim] = ((a + b) / 2 - prim) * this.spacing;
        return { size, off };
    }

    _bridge(dim, endOfRunA, startOfRunB, prim) {
        const from = (endOfRunA - prim) * this.spacing + this.cubeSize / 2 - this.bite;
        const to = (startOfRunB - prim) * this.spacing - this.cubeSize / 2 + this.bite;
        const size = [this.cubeSize, this.cubeSize, this.cubeSize];
        size[dim] = to - from;
        const off = [0, 0, 0];
        off[dim] = (from + to) / 2;

        if (dim === 1) {                       // vertical span -> thin FRONT slab
            size[2] = this.connector;
            off[2] = this.cubeSize / 2 - this.connector / 2;
        } else {                                // horizontal span -> thin TOP slab
            size[1] = this.connector;
            off[1] = this.cubeSize / 2 - this.connector / 2;
        }
        return { size, off };
    }
}
