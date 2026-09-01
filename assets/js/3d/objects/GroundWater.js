import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

// Smooth value-noise heightfield baked into a tangent-space normal map —
// a tileable stand-in for the waternormals.jpg the reference three.js Water
// example loads from disk, avoiding a network asset for a few rolling bumps.
function createNormalTexture(size = 512) {
    // Water.js's own shader (see getNoise() in three/addons/objects/Water.js)
    // samples this map at worldPosition.xz / {103, 107, 8907, ...} — raw world
    // space, not this plane's own 0-1 UV — so on a plane this large it wraps
    // around several times regardless of any texture.repeat we set here. The
    // lattice below is therefore built with a periodic (wrap-around) index so
    // the pattern has zero seam at its own tile edge: an earlier grid+1
    // lattice had a real discontinuity there, which showed up as a hard
    // straight-line seam every time the shader's UV crossed a tile boundary.
    const grid = 8, cell = size / grid;
    const lattice = [];
    for (let y = 0; y < grid; y++) {
        lattice.push([]);
        for (let x = 0; x < grid; x++) lattice[y].push(Math.random());
    }
    const latticeAt = (x, y) => lattice[((y % grid) + grid) % grid][((x % grid) + grid) % grid];
    const smooth = t => t * t * (3 - 2 * t);
    const heightAt = (px, py) => {
        const gx = Math.floor(px / cell), gy = Math.floor(py / cell);
        const fx = smooth((px % cell) / cell), fy = smooth((py % cell) / cell);
        const h00 = latticeAt(gx, gy), h10 = latticeAt(gx + 1, gy);
        const h01 = latticeAt(gx, gy + 1), h11 = latticeAt(gx + 1, gy + 1);
        return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
    };

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const bump = 6;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (heightAt((x + 1) % size, y) - heightAt(x, y)) * bump;
            const dy = (heightAt(x, (y + 1) % size) - heightAt(x, y)) * bump;
            const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
            const i = (y * size + x) * 4;
            image.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
            image.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
            image.data[i + 2] = (inv * 0.5 + 0.5) * 255;
            image.data[i + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

// How many recent cursor positions the ripple trail remembers at once —
// each is its own short-lived expanding ring. Higher = a longer, denser
// trail; RIPPLE_LIFE / RIPPLE_SPAWN_INTERVAL is roughly how many are alive
// at once, so keep this comfortably above that.
const RIPPLE_MAX = 20;
const RIPPLE_LIFE = 1.0;            // seconds a single ripple point stays visible
const RIPPLE_SPAWN_INTERVAL = 0.05; // seconds between recorded trail points while hovering
const MOVE_EPSILON = 1e-4;          // world units; below this counts as "not moving", not real motion

// Patches Water.js's fragment shader (see createNormalTexture's comment for
// why this has to be a manual GLSL splice rather than a normal three.js
// material feature) to fold a fading trail of recent cursor positions into
// the surface normal used for reflection distortion — a light ripple that
// follows the mouse across the water and dies out almost immediately,
// instead of the water reacting to nothing at all when left alone.
function addHoverRipples(water) {
    const material = water.material;
    material.onBeforeCompile = shader => {
        shader.uniforms.uRippleClock = { value: 0 };
        shader.uniforms.uRipplePos = { value: Array.from({ length: RIPPLE_MAX }, () => new THREE.Vector2(1e6, 1e6)) };
        shader.uniforms.uRippleStart = { value: new Array(RIPPLE_MAX).fill(-9999) };
        shader.uniforms.uRippleLife = { value: RIPPLE_LIFE };
        shader.uniforms.uRippleRadius = { value: 1.4 };
        shader.uniforms.uRippleStrength = { value: 0.45 };

        shader.fragmentShader = shader.fragmentShader.replace(
            'uniform vec3 waterColor;',
            `uniform vec3 waterColor;
            uniform float uRippleClock;
            uniform vec2 uRipplePos[${RIPPLE_MAX}];
            uniform float uRippleStart[${RIPPLE_MAX}];
            uniform float uRippleLife;
            uniform float uRippleRadius;
            uniform float uRippleStrength;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
            `vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );

            vec2 rippleKick = vec2( 0.0 );
            for ( int i = 0; i < ${RIPPLE_MAX}; i ++ ) {
                float age = uRippleClock - uRippleStart[ i ];
                if ( age < 0.0 || age > uRippleLife ) continue;
                vec2 toPoint = worldPosition.xz - uRipplePos[ i ];
                float dist = length( toPoint );
                float ring = sin( dist * 7.0 - age * 16.0 );
                float envelope = exp( -age * 3.5 ) * exp( -dist * dist / ( uRippleRadius * uRippleRadius ) ) * smoothstep( 0.0, 0.12, age );
                rippleKick += normalize( toPoint + 1e-4 ) * ring * envelope;
            }
            surfaceNormal = normalize( surfaceNormal + vec3( rippleKick.x, 0.0, rippleKick.y ) * uRippleStrength );`
        );

        // Standing water (a plain THREE.ShaderMaterial) shares its uniforms
        // object between `shader` and `material` directly, but stash it
        // anyway — mirrors the pattern the material-test sandbox relies on
        // for its own hover ripple (see material-test.js's createWaterMaterial),
        // and keeps updateWaterHover below from depending on that assumption.
        material.userData.shader = shader;
    };

    water.userData.rippleWriteIndex = 0;
    water.userData.rippleLastSpawn = -Infinity;
    water.userData.lastHoverPos = null;
}

/**
 * A calm, near-still reflective ground plane (three/addons/objects/Water.js)
 * standing in for a floor. Its base surface is completely static — nothing
 * here ever advances Water.js's own `time` uniform, so left alone it never
 * animates — and it only shows any motion at all as a light ripple trail
 * following the cursor (see updateWaterHover).
 */
export function createGroundWater(sunDirection, { size = 500, y = 0, waterColor = 0xdfe6e2, distortionScale = 0.4 } = {}) {
    const water = new Water(new THREE.PlaneGeometry(size, size), {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: createNormalTexture(512),
        sunDirection,
        sunColor: 0xffffff,
        waterColor,
        distortionScale,
        fog: false
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = y;
    addHoverRipples(water);
    return water;
}

/**
 * Call once per frame with the current world-space (x, z) the cursor is
 * hovering over the water, or null when it isn't. Advances the ripple
 * trail's own clock (independent of Water.js's frozen `time` uniform, so
 * ripples still animate on an otherwise perfectly still surface) and drops a
 * new trail point (at most every RIPPLE_SPAWN_INTERVAL seconds) only while
 * the cursor is actually moving — the instant it stops, spawning stops too,
 * no grace period, and the already-emitted trail just fades out on its own
 * over the next RIPPLE_LIFE seconds.
 */
export function updateWaterHover(water, dt, hoverPoint) {
    const shader = water.material.userData.shader;
    if (!shader) return; // not compiled yet (first frame, before the first render)

    shader.uniforms.uRippleClock.value += dt;
    const clock = shader.uniforms.uRippleClock.value;

    if (!hoverPoint) {
        water.userData.lastHoverPos = null;
        return;
    }

    const last = water.userData.lastHoverPos;
    const moved = !last || Math.hypot(hoverPoint.x - last.x, hoverPoint.z - last.z) > MOVE_EPSILON;
    water.userData.lastHoverPos = { x: hoverPoint.x, z: hoverPoint.z };

    if (moved && clock - water.userData.rippleLastSpawn >= RIPPLE_SPAWN_INTERVAL) {
        const i = water.userData.rippleWriteIndex;
        shader.uniforms.uRipplePos.value[i].set(hoverPoint.x, hoverPoint.z);
        shader.uniforms.uRippleStart.value[i] = clock;
        water.userData.rippleWriteIndex = (i + 1) % RIPPLE_MAX;
        water.userData.rippleLastSpawn = clock;
    }
}
