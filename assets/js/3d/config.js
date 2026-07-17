// Every tunable number in the 3D matrix lives here.
export const MATRIX = {
    spacing: 1.8,        // distance between cell centres
    cubeSize: 1.55,      // solid cube edge length
    connector: 0.24,     // thickness of a bridge slab
    bridgeBite: 0.02,    // bridge penetration into cubes (hides its end caps)
    border: 0.06,        // padding of the bounding wireframe
    labelMargin: 1       // how far row labels sit outside the volume
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
    edgeOpacity: 0.5,
    boundsOpacity: 0.15,
    dimmedRowOpacity: 0.3,
    outlineEps: 0.012,   // tolerance when trimming edges buried inside other boxes
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
