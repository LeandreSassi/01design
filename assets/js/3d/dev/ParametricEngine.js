import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { buildSolidGeometry } from '../geometry/SolidGeometry.js';

// LEVEL 1 of the parametric material system: overall SHAPE. Two knobs:
//
//   cornerRadius  sharp box -> rounded blob. A MASSING (a project fused from
//                 several overlapping boxes + thin bridge slabs) is rebuilt as
//                 a signed-distance field and re-meshed with marching cubes:
//                 each box is a rounded-box SDF, the massing is their
//                 SMOOTH-MIN union, so as radius climbs the parts round AND
//                 fuse into one seamless surface (no detaching at the joints,
//                 which naive round-then-CSG can't avoid). Single-box projects
//                 use a crisp, cheap RoundedBoxGeometry instead.
//
//   irregularity  diversity/randomness in the OVERALL form. A low-frequency
//                 DOMAIN WARP of the field — the sample position is nudged by
//                 smooth value noise before the SDF is evaluated, so the blob
//                 bulges/leans/stretches organically. It's a coherent bend of
//                 space (topology-preserving), so it distorts the shape
//                 without punching holes or severing thin bridges, keeping the
//                 one-connected-surface guarantee. The noise is seeded from the
//                 project's own specs, so each project gets a distinct, stable
//                 distortion (reload-consistent) rather than random-per-build.
//                 Any irregularity > 0 routes even single boxes through the
//                 field so they distort too.
//
// cornerRadius === 0 with irregularity === 0 returns the exact production
// geometry, so "clean + sharp" stays pixel-identical to the live matrix.
// Levels 2 (surface 3D texture) and 3 (projected 2D material) layer on top.

const SEGMENTS = 4;        // RoundedBoxGeometry per-corner subdivisions (single boxes)
const FIELD_RES = 48;      // marching-cubes grid resolution for shape only (no surface texture)
const SURFACE_RES = 64;    // finer grid when surface texture is on, so bumps/pores actually resolve
const MAX_POLYS = 90000;   // marching-cubes triangle budget (buffer sizing) — headroom for a bumpy surface
const WARP_MAX = 0.6;      // domain-warp displacement (world units) at irregularity = 1
const WARP_LOBES = 1.5;    // warp noise cycles across the shape — low = whole-form bends, not surface ripple

// LEVEL 2 surface presets. Each is a displacement added to the distance field
// AFTER the Level-1 shape+warp: `lobes` sets feature density (cycles across the
// shape — higher = finer), `depth` the world-unit amplitude at surface = 1, and
// `kind` how it displaces:
//   even    -> in and out equally (bumps + dents): a rough/raw skin
//   pit     -> inward only (carves cavities): a porous/pocked skin
const SURFACE_TYPES = {
    flat:   null,
    rough:  { lobes: 7, depth: 0.10, octaves: 2, kind: 'even' }, // fine grain, "rugueux"
    wobbly: { lobes: 3, depth: 0.22, octaves: 1, kind: 'even' }, // big soft rolling bumps
    porous: { lobes: 6, depth: 0.24, octaves: 2, kind: 'pit' }   // craters / open pores
};
export const SURFACE_TYPE_NAMES = Object.keys(SURFACE_TYPES);

function roundedSingle(size, off, cornerRadius) {
    const r = Math.min(cornerRadius, Math.min(...size) / 2 - 1e-3);
    const geometry = r > 0
        ? new RoundedBoxGeometry(size[0], size[1], size[2], SEGMENTS, r)
        : new THREE.BoxGeometry(size[0], size[1], size[2]);
    return geometry.translate(off[0], off[1], off[2]);
}

// --- SDF helpers (iquilezles.org/articles/distfunctions) ---

// Rounded box: `half` is the inner half-extent (size/2 - r), so the rounded
// box's OUTER extent stays size/2 — radius carves inward, footprint unchanged.
function sdRoundBox(px, py, pz, cx, cy, cz, hx, hy, hz, r) {
    const qx = Math.abs(px - cx) - hx;
    const qy = Math.abs(py - cy) - hy;
    const qz = Math.abs(pz - cz) - hz;
    const ax = Math.max(qx, 0), ay = Math.max(qy, 0), az = Math.max(qz, 0);
    const outside = Math.sqrt(ax * ax + ay * ay + az * az);
    const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
    return outside + inside - r;
}

// Polynomial smooth-min: blends two distances over a band ~k, fusing
// neighbouring boxes into one surface (k = 0 is a plain min / sharp crease).
function smin(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
}

// --- Smooth value noise, for the domain warp ---
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }
function hash3(i, j, k) {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;                       // [0, 1]
}
function valueNoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    const x00 = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u);
    const x10 = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u);
    const x01 = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u);
    const x11 = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;   // [-1, 1]
}

// Stable per-project seed from its geometry, so identical shapes distort the
// same way and different projects distort differently (visible diversity).
function seedFromSpecs(specs) {
    let s = 2.4;
    for (const { size, off } of specs) {
        s += off[0] * 1.7 + off[1] * 2.3 + off[2] * 3.1 + size[0] * 0.9 + size[1] * 1.3 + size[2] * 0.7;
    }
    return Math.abs(s) % 997;
}

// Fractal (multi-octave) value noise -> [-1, 1]. More octaves = finer grain
// stacked on the base, which is what separates "rough" from smooth "wobbly".
function fbm(x, y, z, octaves) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * valueNoise(x * freq, y * freq, z * freq);
        norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
}

// LEVEL 2 surface displacement at a point (added to the SDF; positive pushes
// the surface inward). `preset` is one of SURFACE_TYPES; freq/seed come from the
// shape so detail density is size-independent and stable per project.
function surfaceDisplace(px, py, pz, preset, amount, freq, seed) {
    const n = fbm(px * freq + seed, py * freq + seed, pz * freq + seed, preset.octaves);
    const disp = preset.kind === 'pit'
        ? Math.max(0, n * 0.5 + 0.5 - 0.55) * 3   // one-sided: only carve inward where noise peaks
        : n;                                       // two-sided: bumps and dents
    return amount * preset.depth * disp;
}

// Reusable marchers, cached per resolution (shape uses FIELD_RES, surface
// texture bumps to SURFACE_RES). Each grid is a fixed normalized [-1,1] cube,
// so one instance per resolution serves every shape; only the field changes.
const _marchers = new Map();
function marcher(res) {
    if (!_marchers.has(res)) _marchers.set(res, new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, MAX_POLYS));
    return _marchers.get(res);
}

function buildField(specs, cornerRadius, irregularity, surface, surfaceType) {
    // Per-box rounded-box SDF params. Radius clamped to just under half the
    // smallest side so thin bridge slabs stay valid (inner half-extent >= 0).
    const boxes = specs.map(({ size, off }) => {
        const r = Math.min(cornerRadius, Math.min(...size) / 2 - 1e-3);
        return {
            cx: off[0], cy: off[1], cz: off[2],
            hx: size[0] / 2 - r, hy: size[1] / 2 - r, hz: size[2] / 2 - r, r
        };
    });
    const k = cornerRadius;                     // smooth-union blend grows with the rounding
    const b0 = boxes[0];

    // Level-2 surface: pick the preset, and only pay for the finer grid when
    // it's actually needed (a bumpy surface needs cells smaller than the bumps).
    const surfacePreset = surface > 0 ? SURFACE_TYPES[surfaceType] : null;
    const resolution = surfacePreset ? SURFACE_RES : FIELD_RES;

    // Isotropic (cubic) sample region around the bounding box, padded so the
    // surface — including outward bulge at joints and domain warp — sits inside
    // a border of empty (outside) cells, which marching cubes needs to close.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    specs.forEach(({ size, off }) => {
        minX = Math.min(minX, off[0] - size[0] / 2); maxX = Math.max(maxX, off[0] + size[0] / 2);
        minY = Math.min(minY, off[1] - size[1] / 2); maxY = Math.max(maxY, off[1] + size[1] / 2);
        minZ = Math.min(minZ, off[2] - size[2] / 2); maxZ = Math.max(maxZ, off[2] + size[2] / 2);
    });
    const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2, oz = (minZ + maxZ) / 2;
    const h0 = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2;

    const warp = irregularity * WARP_MAX;
    const freq = WARP_LOBES / (2 * h0);         // low frequency -> whole-form bends, not ripples
    const seed = seedFromSpecs(specs);
    const s0 = seed, s1 = seed + 37.2, s2 = seed + 91.7;   // decorrelate the 3 warp fields
    const surfFreq = surfacePreset ? surfacePreset.lobes / (2 * h0) : 0;
    const surfSeed = seed + 53.9;
    const surfMaxDepth = surfacePreset ? surface * surfacePreset.depth : 0;
    const H = h0 + cornerRadius + warp + surfMaxDepth + 8 * (2 * h0 / resolution);

    const mc = marcher(resolution);
    mc.isolation = 0;
    mc.reset();
    const size = mc.size, size2 = mc.size2, half = size / 2;

    for (let z = 0; z < size; z++) {
        const wz = oz + ((z - half) / half) * H;
        const zo = z * size2;
        for (let y = 0; y < size; y++) {
            const wy = oy + ((y - half) / half) * H;
            const yo = zo + y * size;
            for (let x = 0; x < size; x++) {
                let px = ox + ((x - half) / half) * H, py = wy, pz = wz;
                if (warp > 0) {
                    const fx = px * freq, fy = py * freq, fz = pz * freq;
                    px += warp * valueNoise(fx + s0, fy + s0, fz + s0);
                    py += warp * valueNoise(fx + s1, fy + s1, fz + s1);
                    pz += warp * valueNoise(fx + s2, fy + s2, fz + s2);
                }
                let d = sdRoundBox(px, py, pz, b0.cx, b0.cy, b0.cz, b0.hx, b0.hy, b0.hz, b0.r);
                for (let b = 1; b < boxes.length; b++) {
                    const bx = boxes[b];
                    d = smin(d, sdRoundBox(px, py, pz, bx.cx, bx.cy, bx.cz, bx.hx, bx.hy, bx.hz, bx.r), k);
                }
                // Level-2 surface texture rides on top of the finished shape.
                if (surfacePreset) d += surfaceDisplace(px, py, pz, surfacePreset, surface, surfFreq, surfSeed);
                mc.field[yo + x] = -d; // inside (d<0) -> field>0, matching MarchingCubes' "high = solid" convention
            }
        }
    }
    mc.update();

    // Extract into a standalone geometry in the specs' own coordinate frame.
    // Verts are normalized [-1,1]; the cubic region maps back as center + v*H.
    // Field-gradient normals are smooth; uniform scale keeps direction, so just
    // renormalize.
    const count = Math.min(mc.count, (mc.positionArray.length / 3) | 0);
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const pa = mc.positionArray, na = mc.normalArray;
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        positions[i3] = ox + pa[i3] * H;
        positions[i3 + 1] = oy + pa[i3 + 1] * H;
        positions[i3 + 2] = oz + pa[i3 + 2] * H;
        const nx = na[i3], ny = na[i3 + 1], nz = na[i3 + 2];
        const len = Math.hypot(nx, ny, nz) || 1;
        normals[i3] = nx / len; normals[i3 + 1] = ny / len; normals[i3 + 2] = nz / len;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geometry;
}

/**
 * @param {{size:number[], off:number[]}[]} specs
 * @param {{cornerRadius?: number, irregularity?: number, surface?: number, surfaceType?: string}} params
 */
export function buildParametricGeometry(specs, params = {}) {
    const { cornerRadius = 0, irregularity = 0, surface = 0, surfaceType = 'flat' } = params;
    const warped = irregularity > 0 || (surface > 0 && surfaceType !== 'flat');

    if (cornerRadius <= 0 && !warped) return buildSolidGeometry(specs);   // exact crisp production geometry
    if (specs.length === 1 && !warped) {                                  // single box, no field detail: crisp & cheap
        const { size, off } = specs[0];
        return roundedSingle(size, off, cornerRadius);
    }
    return buildField(specs, cornerRadius, irregularity, surface, surfaceType);
}

/**
 * Regenerates entry.mesh's geometry from its stored specs + current
 * geometryOptions, disposing the old one and keeping the selection marker
 * sized/positioned to match. No-op if the mesh has no stored specs (e.g.
 * something other than a real project mesh got selected).
 */
export function rebuildGeometry(entry) {
    const specs = entry.mesh.userData.specs;
    if (!specs) return;

    const old = entry.mesh.geometry;
    entry.mesh.geometry = buildParametricGeometry(specs, entry.geometryOptions);
    old.dispose();

    if (entry.marker) {
        entry.mesh.geometry.computeBoundingSphere();
        const { center, radius } = entry.mesh.geometry.boundingSphere;
        entry.marker.position.copy(entry.mesh.position).add(center);
        entry.marker.position.y = entry.mesh.position.y + center.y + radius + 0.35;
    }
}

export function defaultGeometryOptions() {
    return { cornerRadius: 0, irregularity: 0, surface: 0, surfaceType: 'flat' };
}
