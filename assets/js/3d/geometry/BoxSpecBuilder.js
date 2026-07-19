import { contiguousRuns } from '../matrix/Runs.js';

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
     * @returns {{size:number[], off:number[], elongatedDim:number|null}[]}
     *   elongatedDim is the axis (0/1/2) this specific segment stretches
     *   along, or null for a segment that's a plain cube in all 3 dims. A
     *   lane offset must never be applied along a segment's own elongatedDim
     *   — nudging a box sideways along its own length doesn't separate it
     *   from anything (see matrix/LaneLayout.js applyPerSegment).
     */
    build(prims, members) {
        const specs = [];
        let primaryDrawn = false;

        [0, 1, 2].forEach(dim => {
            const runs = contiguousRuns(members[dim]);
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

    _runBox(dim, a, b, prim) {
        const size = [this.cubeSize, this.cubeSize, this.cubeSize];
        size[dim] = (b - a) * this.spacing + this.cubeSize;
        const off = [0, 0, 0];
        off[dim] = ((a + b) / 2 - prim) * this.spacing;
        const elongatedDim = a === b ? null : dim;   // a===b -> plain cube, not actually stretched
        return { size, off, elongatedDim };
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
        return { size, off, elongatedDim: dim };
    }
}
