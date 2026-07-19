// Pure coordinate math for the 3D matrix. No three.js, no scene, no materials —
// just numbers in, numbers out. Every other module asks this one "where".
export class MatrixLayout {
    constructor(dims, spacing, cubeSize) {
        this.dims = dims;         // [countX, countY, countZ]
        this.spacing = spacing;
        this.cubeSize = cubeSize;
    }

    /** Position of row `idx` along a dimension with `count` rows, centred on 0. */
    axisCoord(idx, count) {
        return (idx - (count - 1) / 2) * this.spacing;
    }

    /** World-space centre of cell (ix, iy, iz). */
    cellPosition(ix, iy, iz) {
        return [
            this.axisCoord(ix, this.dims[0]),
            this.axisCoord(iy, this.dims[1]),
            this.axisCoord(iz, this.dims[2])
        ];
    }

    /** Full extent [x, y, z] of the whole matrix, plus an optional border. */
    extent(border = 0) {
        return this.dims.map(n => (n - 1) * this.spacing + this.cubeSize + border);
    }
}
