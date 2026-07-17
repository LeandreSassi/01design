import * as THREE from 'three';

// Builds a clean silhouette line-geometry for a union of axis-aligned boxes.
// Takes each box's 12 edges and trims away any part that runs inside (or on
// the surface of) another box in the same shape — what survives is the true
// outline, with no seams at the articulations between cubes and bridges.

function edgesOfBox({ min, max }) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    return [
        [[x0,y0,z0],[x1,y0,z0]], [[x0,y1,z0],[x1,y1,z0]], [[x0,y0,z1],[x1,y0,z1]], [[x0,y1,z1],[x1,y1,z1]],
        [[x0,y0,z0],[x0,y1,z0]], [[x1,y0,z0],[x1,y1,z0]], [[x0,y0,z1],[x0,y1,z1]], [[x1,y0,z1],[x1,y1,z1]],
        [[x0,y0,z0],[x0,y0,z1]], [[x1,y0,z0],[x1,y0,z1]], [[x0,y1,z0],[x0,y1,z1]], [[x1,y1,z0],[x1,y1,z1]]
    ];
}

// t-range [t0,t1] of segment a->c lying within `box` inflated by eps, or null
function segBoxInterval(a, c, box, eps) {
    let t0 = 0, t1 = 1;
    for (let k = 0; k < 3; k++) {
        const d = c[k] - a[k];
        const mn = box.min[k] - eps, mx = box.max[k] + eps;
        if (Math.abs(d) < 1e-9) {
            if (a[k] < mn || a[k] > mx) return null;
            continue;
        }
        let ta = (mn - a[k]) / d, tb = (mx - a[k]) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 >= t1) return null;
    }
    return [t0, t1];
}

function subtractInterval(intervals, s, e) {
    const out = [];
    intervals.forEach(([a, b]) => {
        if (e <= a || s >= b) { out.push([a, b]); return; }
        if (s > a) out.push([a, s]);
        if (e < b) out.push([e, b]);
    });
    return out;
}

function specToBox({ size, off }) {
    return {
        min: [off[0] - size[0] / 2, off[1] - size[1] / 2, off[2] - size[2] / 2],
        max: [off[0] + size[0] / 2, off[1] + size[1] / 2, off[2] + size[2] / 2]
    };
}

/** @param {{size:number[], off:number[]}[]} specs @param {number} eps */
export function buildOutlineGeometry(specs, eps = 0.012) {
    const boxes = specs.map(specToBox);
    const points = [];

    boxes.forEach((box, i) => {
        edgesOfBox(box).forEach(([a, c]) => {
            let survivors = [[0, 1]];
            boxes.forEach((other, j) => {
                if (j === i || !survivors.length) return;
                const hit = segBoxInterval(a, c, other, eps);
                if (hit) survivors = subtractInterval(survivors, hit[0], hit[1]);
            });
            survivors.forEach(([t0, t1]) => {
                if (t1 - t0 < 1e-3) return;
                points.push(
                    a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0, a[2] + (c[2] - a[2]) * t0,
                    a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1, a[2] + (c[2] - a[2]) * t1
                );
            });
        });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geometry;
}
