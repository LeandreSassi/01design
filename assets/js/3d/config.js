// Every tunable number in the 3D matrix lives here.
export const MATRIX = {
    spacing: 1.8,        // distance between cell centres
    cubeSize: 1.55,      // solid cube edge length (lane 0 of 1, i.e. uncontested)
    connector: 0.24,     // thickness of a bridge slab (uncontested)
    bridgeBite: 0.02,    // bridge penetration into cubes (hides its end caps)
    border: 0.06,        // padding of the bounding wireframe
    labelMargin: 1       // how far row labels sit outside the volume
};

// When several projects share a footprint cell, each gets a small distinct
// (dx,dy,dz) nudge so they don't sit perfectly coincident — overlap itself
// is fine, this just keeps each one visually legible. See LaneLayout.js.
export const LANES = {
    maxOffsetFraction: 0.32   // how far a lane may sit from cell centre, as a fraction of spacing
};

// Live-adjustable overall cube scale — the slider in the top bar controls
// this. Bigger = more fusion/overlap between neighbouring projects, giving
// the dense "agglomerated massing" look. See ui/ScaleControl.js.
export const SCALE = {
    default: 1.6,
    min: 0.5,
    max: 3,
    step: 0.05
};

export const PHYSICS = {
    gravity: 0.02,
    bounce: 0.32,
    dropHeight: 12,
    dropJitter: 4,       // random extra height so cubes don't land in unison
    floorOut: -16,       // y below which a released cube is gone
    settleSpeed: 0.08,   // |vy| under which a bouncing cube comes to rest
    hoverScale: 1.12,
    scaleLerp: 0.2
};

export const APPEARANCE = {
    showProjectEdges: false,   // per-project outlines off; the outer bounds wireframe is separate (MatrixBounds.js)
    edgeOpacity: 0.5,
    boundsOpacity: 0.15,
    dimmedRowOpacity: 0.3,
    roughness: 0.55,
    metalness: 0.05,
    colorSaturation: 0.5,
    colorLightness: 0.6,
    colorBgMix: 0.15,    // how far cube colours are pulled toward the background
    labelFontPx: 20,
    labelScale: 0.012
};

export const CAMERA = {
    fov: 50,
    near: 0.1,
    far: 200,
    position: [11, 8, 13],
    minDistance: 6,
    maxDistance: 45,
    dampingFactor: 0.08
};
