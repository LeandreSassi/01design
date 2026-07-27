import * as THREE from 'three';
import { GUI } from 'lil-gui';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Viewport } from './core/Viewport.js';

// Six overlapping volumes, each with its own independently tweakable
// material. Click a volume to select it; the GUI edits whichever is
// selected. Escape deselects. GUI layout ported from the official three.js
// material browser: https://threejs.org/docs/scenes/material-browser.html#MeshStandardMaterial

const BROKEN_WHITE = '#F2EFE9';
const SELECTION_COLOR = 0x222222;

const SIDE = {
    'THREE.FrontSide': THREE.FrontSide,
    'THREE.BackSide': THREE.BackSide,
    'THREE.DoubleSide': THREE.DoubleSide
};

// Procedural stand-in for the normal.jpg the reference sandbox loads from
// disk — a tileable field of small random tangent-space perturbations, used
// to break up transmission/clearcoat's mid-roughness pixelation and add a
// frosted-glass/orange-peel surface feel. See createNoiseNormalTexture().
const NORMAL_MAP = createNoiseNormalTexture();

// --- Water, based on https://github.com/matsuoka-601/waterball ---
// That project is a WebGPU MLS-MPM fluid sim with screen-space fluid
// rendering; only its *shading* model transfers to a static mesh. Its three
// ingredients — Beer's-law absorption tinting the refracted background,
// fresnel reflection, sharp specular — all exist natively in
// MeshPhysicalMaterial: transmission gives REAL refraction of the scene
// behind the mesh (you see the other volumes through the water),
// attenuationColor/attenuationDistance IS Beer's law, and fresnel/specular
// come with the PBR model. A first attempt as a bespoke ShaderMaterial
// looked like flat blue plastic — static, opaque, analytic-sky-only — so
// this uses the physical material plus an animated wave normal map (the
// motion is what makes it read as liquid; see the onFrame hook in main()).
function createWaterNormalTexture(size = 256) {
    // Smooth value-noise heightfield -> tangent-space normal map. The
    // random-per-pixel NORMAL_MAP used for glass is far too high-frequency
    // for water; waves need smooth rolling blobs.
    const grid = 8, cell = size / grid;
    const lattice = [];
    for (let y = 0; y <= grid; y++) {
        lattice.push([]);
        for (let x = 0; x <= grid; x++) lattice[y].push(Math.random());
    }
    const smooth = t => t * t * (3 - 2 * t);
    const heightAt = (px, py) => {
        const gx = Math.floor(px / cell), gy = Math.floor(py / cell);
        const fx = smooth((px % cell) / cell), fy = smooth((py % cell) / cell);
        const h00 = lattice[gy][gx], h10 = lattice[gy][gx + 1];
        const h01 = lattice[gy + 1][gx], h11 = lattice[gy + 1][gx + 1];
        return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
    };

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const bump = 6; // height-difference amplification into normal xy
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
    texture.repeat.set(2, 2);
    return texture;
}

function createWaterMaterial() {
    // Per-material texture instance: offset is animated per volume in
    // main()'s onFrame, so water volumes can't share one texture object.
    const waveMap = createWaterNormalTexture();
    const material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,           // near-clear surface; the tint comes from absorption
        roughness: 0.05,
        metalness: 0,
        transmission: 1,           // real see-through refraction of the scene
        ior: 1.33,                 // water
        thickness: 1.5,
        attenuationColor: new THREE.Color(0x1fa9c9), // Beer's-law tint
        attenuationDistance: 0.5,  // how quickly light turns teal inside the volume
        normalMap: waveMap,
        normalScale: new THREE.Vector2(0.6, 0.6)
    });
    material.userData.isWater = true;
    material.userData.waveSpeed = 0.06;
    material.userData.hoverRadius = 2.5;
    material.userData.hoverStrength = 0.8;

    // Hover ripple: rings radiating outward from the cursor's hit point,
    // continuously animated by the same clock as the wave scroll while
    // hovering, gone instantly otherwise. Injected into objectNormal (object
    // space, pre-normalMatrix) so it combines correctly with the rest of the
    // normal pipeline — including the tangent-space wave normalMap, which is
    // applied later in the fragment shader.
    material.onBeforeCompile = shader => {
        shader.uniforms.uHoverPoint = { value: new THREE.Vector3(0, -9999, 0) };
        shader.uniforms.uRippleTime = { value: 0 };
        shader.uniforms.uRippleActive = { value: 0 };
        shader.uniforms.uRippleRadius = { value: material.userData.hoverRadius };
        shader.uniforms.uRippleStrength = { value: material.userData.hoverStrength };

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec3 uHoverPoint;
            uniform float uRippleTime;
            uniform float uRippleActive;
            uniform float uRippleRadius;
            uniform float uRippleStrength;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
            {
                vec2 delta = position.xz - uHoverPoint.xz;
                float dist = length(delta);
                float envelope = exp(-dist * (3.0 / max(uRippleRadius, 0.001)));
                float ripple = sin(dist * 14.0 - uRippleTime * 9.0) * envelope * uRippleActive;
                vec2 dir = dist > 0.0001 ? delta / dist : vec2(1.0, 0.0);
                objectNormal.xz += dir * ripple * uRippleStrength;
                objectNormal = normalize(objectNormal);
            }`
        );
        material.userData.shader = shader;
    };
    return material;
}

const MATERIAL_TYPES = {
    MeshStandardMaterial: color => new THREE.MeshStandardMaterial({ color }),
    MeshPhysicalMaterial: color => new THREE.MeshPhysicalMaterial({ color, clearcoat: 1, clearcoatRoughness: 0.1 }),
    // Not a real three.js class — a MeshPhysicalMaterial tuned per
    // https://tympanus.net/codrops/2021/10/27/creating-the-effect-of-transparent-glass-and-plastic-in-three-js/
    // (transmission/thickness + a procedural normal map), kept as its own
    // preset so plain MeshPhysicalMaterial stays untouched.
    MeshGlassMaterial: color => new THREE.MeshPhysicalMaterial({
        color, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, transmission: 1, thickness: 1,
        normalMap: NORMAL_MAP, normalScale: new THREE.Vector2(0.3, 0.3),
        clearcoatNormalMap: NORMAL_MAP, clearcoatNormalScale: new THREE.Vector2(0.2, 0.2)
    }),
    MeshToonMaterial: color => new THREE.MeshToonMaterial({ color }),
    // Not a real three.js class — this is the underlying surface a volume
    // sits on when grass is grown on it (see createGrassMesh() below), based
    // on the instancing technique from https://github.com/FeliDipi/Grass
    FurGrassMaterial: color => new THREE.MeshStandardMaterial({ color, roughness: 1 }),
    // Not a real three.js class — see createWaterMaterial() above.
    // Ignores the incoming color on purpose — unlike the other presets,
    // "water tinted whatever the last material happened to be" doesn't read
    // as water. Always starts at the same blue/teal; change uWaterColor in
    // the GUI afterward if you want a different tint.
    MeshWaterMaterial: () => createWaterMaterial()
};

// A plain bright gradient "sky" to bake into an env map — deliberately has
// no dark/black regions anywhere, because clearcoat (MeshPhysicalMaterial /
// MeshGlassMaterial) mirrors the environment almost perfectly at grazing
// angles (right at a mesh's silhouette). RoomEnvironment's dark walls/corners
// showed up as a black rim around every clearcoat object; this avoids that.
function createEnvironmentScene() {
    const scene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(50, 32, 32);
    const top = new THREE.Color(0xffffff);
    const bottom = new THREE.Color(0xcfcac2); // light warm gray — never black
    const colors = [];
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
        const t = THREE.MathUtils.clamp((position.getY(i) + 50) / 100, 0, 1);
        const c = bottom.clone().lerp(top, t);
        colors.push(c.r, c.g, c.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    scene.add(new THREE.Mesh(geometry, material));
    return scene;
}

function createNoiseNormalTexture(size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = 128 + (Math.random() * 2 - 1) * 24;     // x
        image.data[i + 1] = 128 + (Math.random() * 2 - 1) * 24; // y
        image.data[i + 2] = 255;                                // z (mostly facing out)
        image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    return texture;
}

// --- Grass, ported (simplified) from https://github.com/FeliDipi/Grass ---
// Instanced flat-triangle blades scattered over a mesh's own surface, oriented
// to the local normal, with wind sway and a base->tip color gradient done in
// the vertex/fragment shaders. Original uses InstancedBufferGeometry + a
// RawShaderMaterial with per-instance offset/scale/phase/quaternion
// attributes — same approach here, just a single wind term instead of the
// full local-sway + traveling-wave + noise stack (that scene was a 30-unit
// open field; ours is a small object, so one term already reads fine).

const GRASS_VERTEX_SHADER = `
attribute vec3 aOffset;
attribute float aScale;
attribute float aPhase;
attribute vec4 aQuat;

uniform float uTime;
uniform float uWindStrength;
uniform float uBladeHeight;
uniform vec3 uHoverPoint;
uniform float uHoverRadius;
uniform float uHoverStrength;
uniform float uHoverActive;

varying float vProgress;
varying float vShade;

vec3 applyQuat(vec3 v, vec4 q) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
    vec3 pos = position;
    float progress = clamp(pos.y, 0.0, 1.0);
    vProgress = progress;
    pos.y *= uBladeHeight * aScale;

    float t = uTime + aPhase;
    float sway = sin(t * 1.3) + cos(t * 0.7);
    sway *= uWindStrength * progress * progress;
    pos.x += sway * 0.15;
    pos.z += sway * 0.1;

    vShade = 0.82 + 0.18 * fract(sin(aPhase * 12.9898) * 43758.5453);

    vec3 rotated = applyQuat(pos, aQuat);
    vec3 worldPos = rotated + aOffset;

    // Push blades away from wherever the cursor is hovering over the
    // surface — a finger-through-fur effect. Distance/push happen in the
    // same local space as aOffset (grass is a child of its volume's mesh).
    vec3 toBlade = aOffset - uHoverPoint;
    float hoverDist = length(toBlade);
    vec3 pushDir = hoverDist > 0.0001 ? toBlade / hoverDist : vec3(1.0, 0.0, 0.0);
    float influence = smoothstep(uHoverRadius, 0.0, hoverDist) * uHoverStrength * uHoverActive * progress;
    worldPos += pushDir * influence * 0.4;
    worldPos.y -= influence * uBladeHeight * aScale * 0.5;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

const GRASS_FRAGMENT_SHADER = `
uniform vec3 uColorBottom;
uniform vec3 uColorTop;
varying float vProgress;
varying float vShade;

void main() {
    vec3 color = mix(uColorBottom, uColorTop, pow(vProgress, 1.2)) * vShade;
    gl_FragColor = vec4(color, 1.0);
}
`;

// Area-weighted random point + interpolated normal on a triangle mesh surface.
function sampleSurfacePoints(geometry, count) {
    const pos = geometry.attributes.position;
    const norm = geometry.attributes.normal;
    const index = geometry.index;
    const triCount = index ? index.count / 3 : pos.count / 3;

    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const vertexAt = (t, offset, target) => {
        const idx = index ? index.getX(t * 3 + offset) : t * 3 + offset;
        target.fromBufferAttribute(pos, idx);
    };
    const normalAt = (t, offset, target) => {
        if (!norm) return target.set(0, 1, 0);
        const idx = index ? index.getX(t * 3 + offset) : t * 3 + offset;
        return target.fromBufferAttribute(norm, idx);
    };

    const areas = new Float32Array(triCount);
    let totalArea = 0;
    const ab = new THREE.Vector3(), ac = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
        vertexAt(t, 0, a); vertexAt(t, 1, b); vertexAt(t, 2, c);
        const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
        areas[t] = area;
        totalArea += area;
    }

    const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
    const points = [];
    for (let i = 0; i < count; i++) {
        let r = Math.random() * totalArea;
        let t = 0;
        while (t < triCount - 1 && r > areas[t]) { r -= areas[t]; t++; }

        vertexAt(t, 0, a); vertexAt(t, 1, b); vertexAt(t, 2, c);
        normalAt(t, 0, na); normalAt(t, 1, nb); normalAt(t, 2, nc);

        let u = Math.random(), v = Math.random();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const w = 1 - u - v;

        const position = new THREE.Vector3(
            a.x * w + b.x * u + c.x * v,
            a.y * w + b.y * u + c.y * v,
            a.z * w + b.z * u + c.z * v
        );
        const normal = new THREE.Vector3(
            na.x * w + nb.x * u + nc.x * v,
            na.y * w + nb.y * u + nc.y * v,
            na.z * w + nb.z * u + nc.z * v
        ).normalize();

        points.push({ position, normal });
    }
    return points;
}

const BLADE_GEOMETRY = (() => {
    // Thin sliver, not a wide paddle — width is a small fraction of the
    // (unit) height so it reads as a grass blade rather than a spike.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.008, 0, 0, 0.008, 0, 0, 0, 1, 0
    ], 3));
    return geometry;
})();
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// Orients a blade so its local X axis (the flat triangle's azimuthal facing)
// points along `combDir` projected onto the surface's tangent plane, rather
// than a fully random angle around the normal — that's what reads as
// "chaotic tufts" vs. "combed fur". `jitter` (radians) adds back a little
// per-blade variation without losing the overall combed direction.
function computeBladeQuaternion(normal, combDir, jitter) {
    let tangent = combDir.clone().projectOnPlane(normal);
    if (tangent.lengthSq() < 1e-6) {
        tangent = new THREE.Vector3(1, 0, 0).projectOnPlane(normal);
        if (tangent.lengthSq() < 1e-6) tangent = new THREE.Vector3(0, 0, 1).projectOnPlane(normal);
    }
    tangent.normalize();
    if (jitter > 0) tangent.applyAxisAngle(normal, (Math.random() - 0.5) * jitter);
    const zAxis = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    const basis = new THREE.Matrix4().makeBasis(tangent, normal, zAxis);
    return new THREE.Quaternion().setFromRotationMatrix(basis);
}

function createGrassMesh(points, options) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = BLADE_GEOMETRY.index;
    geometry.attributes.position = BLADE_GEOMETRY.attributes.position;
    geometry.instanceCount = points.length;

    const offsets = new Float32Array(points.length * 3);
    const scales = new Float32Array(points.length);
    const phases = new Float32Array(points.length);
    const quats = new Float32Array(points.length * 4);

    const combRad = THREE.MathUtils.degToRad(options.combAngle);
    const combDir = new THREE.Vector3(Math.cos(combRad), 0, Math.sin(combRad));

    points.forEach((p, i) => {
        offsets[i * 3] = p.position.x;
        offsets[i * 3 + 1] = p.position.y;
        offsets[i * 3 + 2] = p.position.z;
        scales[i] = 0.8 + Math.random() * 0.4;
        phases[i] = Math.random() * Math.PI * 2;

        const q = computeBladeQuaternion(p.normal, combDir, options.directionJitter);
        quats[i * 4] = q.x; quats[i * 4 + 1] = q.y;
        quats[i * 4 + 2] = q.z; quats[i * 4 + 3] = q.w;
    });

    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    geometry.setAttribute('aQuat', new THREE.InstancedBufferAttribute(quats, 4));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uWindStrength: { value: options.windStrength },
            uBladeHeight: { value: options.bladeHeight },
            uColorBottom: { value: new THREE.Color(options.colorBottom) },
            uColorTop: { value: new THREE.Color(options.colorTop) },
            uHoverPoint: { value: new THREE.Vector3() },
            uHoverRadius: { value: options.hoverRadius },
            uHoverStrength: { value: options.hoverStrength },
            uHoverActive: { value: 0 }
        },
        vertexShader: GRASS_VERTEX_SHADER,
        fragmentShader: GRASS_FRAGMENT_SHADER,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
}

// Adds/removes/regrows a volume's grass mesh to match its current
// materialTypeName + grassOptions. Grass is added as a child of the volume's
// own mesh, so blade offsets sampled in the geometry's local space line up
// without any extra transform bookkeeping.
function updateGrass(volume) {
    if (volume.grass) {
        volume.mesh.remove(volume.grass);
        volume.grass.geometry.dispose();
        volume.grass.material.dispose();
        volume.grass = null;
    }
    if (volume.materialTypeName === 'FurGrassMaterial') {
        // Underlying surface matches the blade base color, so any of it
        // peeking through at the edges/gaps reads as more grass, not a
        // mismatched patch of skin color underneath.
        volume.mesh.material.color.set(volume.grassOptions.colorBottom);
        const points = sampleSurfacePoints(volume.mesh.geometry, volume.grassOptions.density);
        volume.grass = createGrassMesh(points, volume.grassOptions);
        volume.mesh.add(volume.grass);
    }
}

// --- Generic instanced-particle system ---
// One InstancedMesh + a fixed pool of {position, velocity, life} slots,
// config-driven so the same engine can back very different effects: water
// droplets today, sand grains or other "wobbly interactive" particles later.
// Nothing here is water-specific — that lives in createWaterSplash() below,
// which is just one *preset* built on top of this.
//
// config:
//   geometry, material   three.js instances, shared across the pool
//   poolSize             instance count
//   gravity, drag        per-second acceleration / velocity damping (0 = none)
//   orient               'velocity' (rotates to face direction of travel,
//                         e.g. droplets) or 'fixed' (orientation set once at
//                         spawn from the `direction` param, e.g. a flat decal
//                         oriented to a surface normal)
//   stretch              elongate scale along the travel direction in
//                         proportion to current speed (streaky, watery look)
//   sizeCurve(t)          t goes from 1 (birth) to 0 (death); returns a scale
//                         multiplier. Lets a preset shrink-to-nothing
//                         (droplets), grow-then-collapse (a splash ring),
//                         stay constant then cut off (sand), etc.
function createParticleSystem(viewport, config) {
    const { geometry, material, poolSize, gravity = 0, drag = 0, orient = 'velocity', stretch = false, sizeCurve = t => t } = config;

    const mesh = new THREE.InstancedMesh(geometry, material, poolSize);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    viewport.add(mesh);

    const particles = Array.from({ length: poolSize }, () => ({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        orientation: new THREE.Quaternion(),
        life: 0, maxLife: 1, baseSize: 1
    }));
    let nextIndex = 0;
    const matrix = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
    const travelDir = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);

    // direction: initial velocity axis ('velocity' orient) or the fixed
    // orientation axis to align +Y to ('fixed' orient, e.g. a surface normal).
    function spawn(origin, direction, color, count, opts = {}) {
        const {
            speedMin = 0.6, speedMax = 1.4, spread = 1.2, upBoost = 1.2,
            lifeMin = 0.4, lifeMax = 0.9, sizeMin = 0.02, sizeMax = 0.05
        } = opts;

        for (let n = 0; n < count; n++) {
            const idx = nextIndex;
            nextIndex = (nextIndex + 1) % poolSize;
            const p = particles[idx];

            p.position.copy(origin);
            if (orient === 'fixed') {
                p.velocity.set(0, 0, 0);
                p.orientation.setFromUnitVectors(UP, direction);
            } else {
                p.velocity.copy(direction).multiplyScalar(speedMin + Math.random() * (speedMax - speedMin));
                p.velocity.x += (Math.random() - 0.5) * spread;
                p.velocity.y += upBoost * Math.random();
                p.velocity.z += (Math.random() - 0.5) * spread;
            }

            p.maxLife = lifeMin + Math.random() * (lifeMax - lifeMin);
            p.life = p.maxLife;
            p.baseSize = sizeMin + Math.random() * (sizeMax - sizeMin);
            mesh.setColorAt(idx, color);
        }
        mesh.instanceColor.needsUpdate = true;
    }

    function update(dt) {
        for (let i = 0; i < poolSize; i++) {
            const p = particles[i];
            if (p.life > 0) {
                p.life -= dt;
                if (gravity) p.velocity.y -= gravity * dt;
                if (drag) p.velocity.multiplyScalar(Math.max(0, 1 - drag * dt));
                p.position.addScaledVector(p.velocity, dt);
            }

            const t = p.life > 0 ? p.life / p.maxLife : 0;
            const s = p.life > 0 ? p.baseSize * sizeCurve(t) : 0;

            if (orient === 'velocity' && p.velocity.lengthSq() > 1e-6) {
                travelDir.copy(p.velocity).normalize();
                p.orientation.setFromUnitVectors(UP, travelDir);
            }

            if (stretch) {
                const speed = p.velocity.length();
                const elongation = THREE.MathUtils.clamp(1 + speed * 0.35, 1, 3.5);
                scaleVec.set(s, s * elongation, s);
            } else {
                scaleVec.set(s, s, s);
            }

            matrix.compose(p.position, p.orientation, scaleVec);
            mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }

    return { mesh, spawn, update };
}

// --- Water splash preset ---
// Two particle systems built on the generic engine above: real transmissive
// droplets that streak along their velocity (rounding out as they slow, like
// actual water rather than bouncy balls), plus a flat "crown" ring that
// pops out from the impact point and collapses — the classic splash
// silhouette. Not a fluid sim, just enough of the right *shapes* of motion.
function createWaterSplash(viewport) {
    const dropletGeometry = new THREE.IcosahedronGeometry(1, 1); // a bit smoother than a raw icosahedron facets nicely with transmission
    const dropletMaterial = new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.05, metalness: 0,
        transmission: 0.9, thickness: 0.3, ior: 1.33,
        transparent: true
    });
    const droplets = createParticleSystem(viewport, {
        geometry: dropletGeometry, material: dropletMaterial, poolSize: 200,
        gravity: 5, drag: 0.4, orient: 'velocity', stretch: true,
        sizeCurve: t => t // shrink linearly to nothing
    });

    const ringGeometry = new THREE.RingGeometry(0.7, 1, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false
    });
    const rings = createParticleSystem(viewport, {
        geometry: ringGeometry, material: ringMaterial, poolSize: 12,
        gravity: 0, drag: 0, orient: 'fixed', stretch: false,
        // pop out fast, then collapse — reads as an expanding ring that
        // dissipates rather than a disc that just shrinks uniformly.
        sizeCurve: t => t < 0.7 ? THREE.MathUtils.lerp(0.2, 1, 1 - t / 0.7) : THREE.MathUtils.lerp(1, 0, (t - 0.7) / 0.3)
    });

    function spawn(origin, normal, color, big) {
        droplets.spawn(origin, normal, color, big ? 45 : 4, {
            speedMin: big ? 1.4 : 0.5, speedMax: big ? 3.2 : 1.1,
            spread: big ? 2.2 : 0.8, upBoost: big ? 2.4 : 0.9,
            lifeMin: 0.3, lifeMax: big ? 0.8 : 0.5,
            sizeMin: 0.012, sizeMax: big ? 0.035 : 0.022
        });
        if (big) {
            rings.spawn(origin, normal, color, 1, { lifeMin: 0.35, lifeMax: 0.35, sizeMin: 0.9, sizeMax: 0.9 });
        }
    }

    function update(dt) {
        droplets.update(dt);
        rings.update(dt);
    }

    return { spawn, update };
}

// Boxes, a rectangle, rounded shapes and a torus, positioned to overlap into one blob.
const VOLUMES = [
    { name: 'Cube', geometry: new THREE.BoxGeometry(1.4, 1.4, 1.4), position: [-1.1, 0.1, 0.3], color: 0xe07a3e },
    { name: 'Rounded box', geometry: new RoundedBoxGeometry(1.6, 1.1, 1.3, 4, 0.25), position: [0.0, 0.35, -0.2], color: 0x3e7ae0 },
    { name: 'Rectangle', geometry: new THREE.BoxGeometry(2.0, 0.8, 1.0), position: [1.0, -0.2, 0.4], color: 0x6fbf73 },
    { name: 'Rounded cube', geometry: new RoundedBoxGeometry(1.2, 1.2, 1.2, 4, 0.3), position: [1.7, 0.6, -0.3], color: 0xe0c23e },
    { name: 'Capsule', geometry: new THREE.CapsuleGeometry(0.5, 0.8, 4, 8), position: [0.4, 1.0, 0.2], color: 0xb06fe0 },
    { name: 'Torus', geometry: new THREE.TorusGeometry(0.7, 0.28, 16, 48), position: [-0.4, -0.3, 1.0], color: 0xe04f7a }
];

// Which color to carry over when switching material type. Water's .color is
// white (its visible tint is the Beer's-law attenuationColor), so use that
// tint instead when leaving water for another material class.
function getMaterialColor(material) {
    if (material.userData && material.userData.isWater) return material.attenuationColor;
    return material.color || new THREE.Color(0xffffff);
}

function handleColorChange(color) {
    return value => color.setHex(value);
}

function needsUpdate(material) {
    return () => { material.needsUpdate = true; };
}

// A small ring that floats above a volume when selected — it never touches
// or overlaps the mesh, so it can't affect how the material actually reads.
function createSelectionMarker(geometry) {
    geometry.computeBoundingSphere();
    const r = geometry.boundingSphere.radius;
    const marker = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.35, r * 0.45, 32),
        new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = geometry.boundingSphere.center.y + r + 0.35;
    marker.visible = false;
    return marker;
}

function main() {
    const canvas = document.getElementById('scene');
    const viewport = new Viewport(canvas, { background: BROKEN_WHITE });
    viewport.scene.fog = new THREE.Fog(BROKEN_WHITE, 20, 70);

    // Glass/plastic transmission and clearcoat only read as convincing with
    // something to reflect and refract. PMREMGenerator bakes a procedural
    // bright gradient env map — no external HDRI file needed.
    // See https://tympanus.net/codrops/2021/10/27/creating-the-effect-of-transparent-glass-and-plastic-in-three-js/
    const pmremGenerator = new THREE.PMREMGenerator(viewport.renderer);
    viewport.scene.environment = pmremGenerator.fromScene(createEnvironmentScene(), 0.04).texture;
    pmremGenerator.dispose();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    viewport.add(ambientLight);

    viewport.renderer.shadowMap.enabled = true;
    viewport.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(5, 8, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.radius = 4;
    viewport.add(sun);

    // A real slab, not a see-through shadow-catcher plane — solid color,
    // visible thickness, sits on the fog-shrouded horizon.
    const groundThickness = 0.4;
    const ground = new THREE.Mesh(
        new THREE.BoxGeometry(500, groundThickness, 500),
        new THREE.MeshStandardMaterial({ color: BROKEN_WHITE, roughness: 0.9, metalness: 0 })
    );
    ground.position.y = -0.6 - groundThickness / 2; // top face still meets the lowest-sitting volumes
    ground.receiveShadow = true;
    viewport.add(ground);

    viewport.camera.position.set(0, 2.5, 6);

    const volumes = VOLUMES.map(v => {
        const material = MATERIAL_TYPES.MeshStandardMaterial(new THREE.Color(v.color));
        const mesh = new THREE.Mesh(v.geometry, material);
        mesh.position.set(...v.position);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        viewport.add(mesh);

        const marker = createSelectionMarker(v.geometry);
        marker.position.x += mesh.position.x;
        marker.position.y += mesh.position.y;
        marker.position.z += mesh.position.z;
        viewport.add(marker);

        return {
            name: v.name, mesh, marker, materialTypeName: 'MeshStandardMaterial', grass: null,
            grassOptions: {
                density: 8000, bladeHeight: 0.12, windStrength: 0.6,
                colorBottom: '#1e3a1e', colorTop: '#6fbf73',
                combAngle: 0, directionJitter: 0.3,
                hoverRadius: 0.6, hoverStrength: 1.2
            }
        };
    });

    // --- GUI: "Scene" folder is persistent; the rest rebuilds per selection ---
    const gui = new GUI();
    guiScene(gui, viewport.scene);
    guiSun(gui, sun);

    const selectionFolder = gui.addFolder('Selected: none');
    const typeProxy = { type: 'MeshStandardMaterial' };
    const typeController = selectionFolder.add(typeProxy, 'type', Object.keys(MATERIAL_TYPES)).onChange(name => {
        if (!selected) return;
        const old = selected.mesh.material;
        selected.materialTypeName = name;
        selected.mesh.material = MATERIAL_TYPES[name](getMaterialColor(old).clone());
        old.dispose();
        updateGrass(selected);
        rebuildMaterialFolders(selected);
    });

    let materialFolder = null;
    let specificFolder = null;
    let selected = null;

    function rebuildMaterialFolders(volume) {
        if (materialFolder) materialFolder.destroy();
        if (specificFolder) specificFolder.destroy();
        // For grass, this base folder only touches the dirt surface under
        // the blades — say so, since the blades (what you actually see) are
        // a separate mesh/material these controls don't reach.
        const label = volume.materialTypeName === 'FurGrassMaterial' ? 'THREE.Material (surface only, not blades)' : 'THREE.Material';
        materialFolder = guiMaterialBase(gui, volume.mesh.material, label);
        specificFolder = guiMaterialSpecific(gui, volume.mesh.material, volume.materialTypeName, volume);
    }

    function select(volume) {
        if (selected) selected.marker.visible = false;
        selected = volume;
        selected.marker.visible = true;

        selectionFolder.title('Selected: ' + volume.name);
        typeProxy.type = volume.materialTypeName;
        typeController.updateDisplay();
        rebuildMaterialFolders(volume);
    }

    function deselect() {
        if (!selected) return;
        selected.marker.visible = false;
        selected = null;

        selectionFolder.title('Selected: none');
        if (materialFolder) { materialFolder.destroy(); materialFolder = null; }
        if (specificFolder) { specificFolder.destroy(); specificFolder = null; }
    }
    select(volumes[0]);

    const waterSplash = createWaterSplash(viewport);
    let lastTrickleTime = 0;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    canvas.addEventListener('click', e => {
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(pointer, viewport.camera);
        const hit = raycaster.intersectObjects(volumes.map(v => v.mesh))[0];
        if (!hit) return;

        if (hit.object.material.userData.isWater) {
            const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
            waterSplash.spawn(hit.point, worldNormal, hit.object.material.attenuationColor, true);
        }
        select(volumes.find(v => v.mesh === hit.object));
    });

    // Fur/grass "push away from cursor" and water "ripple from cursor"
    // reactivity — raycast against whichever volumes currently have grass
    // or a water material, and feed each its own local-space hit point.
    const hoverLocalPoint = new THREE.Vector3();
    canvas.addEventListener('pointermove', e => {
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(pointer, viewport.camera);

        const grassVolumes = volumes.filter(v => v.grass);
        if (grassVolumes.length) {
            const hit = raycaster.intersectObjects(grassVolumes.map(v => v.mesh))[0];
            grassVolumes.forEach(v => {
                const uniforms = v.grass.material.uniforms;
                if (hit && hit.object === v.mesh) {
                    hoverLocalPoint.copy(hit.point);
                    v.mesh.worldToLocal(hoverLocalPoint);
                    uniforms.uHoverPoint.value.copy(hoverLocalPoint);
                    uniforms.uHoverActive.value = 1;
                } else {
                    uniforms.uHoverActive.value = 0;
                }
            });
        }

        const waterVolumes = volumes.filter(v => v.mesh.material.userData.isWater && v.mesh.material.userData.shader);
        if (waterVolumes.length) {
            const hit = raycaster.intersectObjects(waterVolumes.map(v => v.mesh))[0];
            waterVolumes.forEach(v => {
                const uniforms = v.mesh.material.userData.shader.uniforms;
                if (hit && hit.object === v.mesh) {
                    hoverLocalPoint.copy(hit.point);
                    v.mesh.worldToLocal(hoverLocalPoint);
                    uniforms.uHoverPoint.value.copy(hoverLocalPoint);
                    uniforms.uRippleActive.value = 1;
                } else {
                    uniforms.uRippleActive.value = 0;
                }
            });

            // A light continuous trickle while hovering, on top of the
            // bigger click burst — throttled so it's a handful of droplets,
            // not a shower.
            const now = performance.now();
            if (hit && now - lastTrickleTime > 90) {
                lastTrickleTime = now;
                const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
                waterSplash.spawn(hit.point, worldNormal, hit.object.material.attenuationColor, false);
            }
        }
    });

    window.addEventListener('keydown', e => {
        if (e.key === 'Escape') deselect();
    });

    let lastFrameTime = performance.now() / 1000;
    viewport.onFrame(() => {
        const t = performance.now() / 1000;
        const dt = Math.min(t - lastFrameTime, 0.1); // clamp so a stall doesn't fling particles
        lastFrameTime = t;

        volumes.forEach(v => {
            if (v.grass) v.grass.material.uniforms.uTime.value = t;
            const m = v.mesh.material;
            if (m.userData.isWater && m.normalMap) {
                // Two incommensurate drift frequencies so the wave pattern
                // never settles into an obvious straight-line scroll.
                const s = m.userData.waveSpeed;
                m.normalMap.offset.set(t * s + 0.3 * Math.sin(t * s * 4.7), t * s * 0.6 + 0.3 * Math.cos(t * s * 3.1));
                if (m.userData.shader) m.userData.shader.uniforms.uRippleTime.value = t;
            }
        });
        waterSplash.update(dt);
    });
    viewport.start();
}

// --- "Sun" folder: the shadow-casting directional light ---
function guiSun(gui, sun) {
    const folder = gui.addFolder('Sun');
    const data = { color: sun.color.getHex() };
    folder.addColor(data, 'color').onChange(handleColorChange(sun.color));
    folder.add(sun, 'intensity', 0, 5, 0.01);
    folder.add(sun.position, 'x', -20, 20, 0.1);
    folder.add(sun.position, 'y', 0, 20, 0.1);
    folder.add(sun.position, 'z', -20, 20, 0.1);
    folder.add(sun, 'castShadow');
    folder.add(sun.shadow, 'radius', 0, 10, 0.1);
    return folder;
}

// --- "Scene" folder: ambient light + fog toggle, mirroring the reference panel ---
function guiScene(gui, scene) {
    const folder = gui.addFolder('Scene');
    const data = { 'ambient light': 0x999999 };
    folder.addColor(data, 'ambient light').onChange(handleColorChange(scene.children.find(c => c.isAmbientLight).color));
    guiSceneFog(folder, scene);
    return folder;
}

function guiSceneFog(folder, scene) {
    const fogFolder = folder.addFolder('scene.fog');
    const savedFog = scene.fog;
    // near/far scaled to this rig's camera distance (~6-8 units) — the
    // reference demo's 0-60 range assumes a much larger scene and is barely
    // visible here.
    const fog = new THREE.Fog(0x3f7b9d, 1, 12);

    const data = {
        fog: {
            'THREE.Fog()': false,
            'scene.fog.color': fog.color.getHex()
        }
    };

    fogFolder.add(data.fog, 'THREE.Fog()').onChange(useFog => {
        scene.fog = useFog ? fog : savedFog;
    });
    fogFolder.addColor(data.fog, 'scene.fog.color').onChange(handleColorChange(fog.color));
}

// --- base "THREE.Material" folder, same properties/order as the reference ---
// alphaTest/alphaHash are deliberately not exposed: both only do anything
// against a texture's alpha channel, and nothing in this sandbox ever loads
// a texture map — they'd be dead sliders on every single material type.
// `label` lets callers clarify when this only covers an underlying surface
// rather than what's actually dominant on screen (e.g. FurGrassMaterial's
// blades are a separate mesh/material entirely, untouched by this folder).
function guiMaterialBase(gui, material, label = 'THREE.Material') {
    const folder = gui.addFolder(label);
    folder.add(material, 'transparent').onChange(needsUpdate(material));
    folder.add(material, 'opacity', 0, 1).step(0.01);
    folder.add(material, 'depthTest');
    folder.add(material, 'depthWrite');
    folder.add(material, 'visible');
    folder.add(material, 'side', SIDE).onChange(needsUpdate(material));
    return folder;
}

// --- material-class-specific folder ---
function guiMaterialSpecific(gui, material, typeName, volume) {
    if (typeName === 'MeshToonMaterial') return guiMeshToonMaterial(gui, material);
    if (typeName === 'MeshGlassMaterial') return guiMeshGlassMaterial(gui, material);
    if (typeName === 'MeshPhysicalMaterial') return guiMeshPhysicalMaterial(gui, material);
    if (typeName === 'FurGrassMaterial') return guiFurGrassMaterial(gui, material, volume);
    if (typeName === 'MeshWaterMaterial') return guiMeshWaterMaterial(gui, material);
    return guiMeshStandardMaterial(gui, material);
}

// Texture-map dropdowns (map/roughnessMap/alphaMap/metalnessMap/envMaps)
// and vertexColors from the reference guiMeshStandardMaterial() are omitted
// on purpose: this sandbox never loads a texture asset or sets a `color`
// geometry attribute on any volume, so every one of those controls would be
// a dead no-op regardless of which material type is selected.
function guiMeshStandardMaterial(gui, material) {
    const data = {
        color: material.color.getHex(),
        emissive: material.emissive.getHex()
    };

    const folder = gui.addFolder('THREE.MeshStandardMaterial');
    folder.addColor(data, 'color').onChange(handleColorChange(material.color));
    folder.addColor(data, 'emissive').onChange(handleColorChange(material.emissive));
    folder.add(material, 'roughness', 0, 1);
    folder.add(material, 'metalness', 0, 1);
    folder.add(material, 'envMapIntensity', 0, 3, 0.01);
    folder.add(material, 'flatShading').onChange(needsUpdate(material));
    folder.add(material, 'wireframe').onChange(needsUpdate(material));
    folder.add(material, 'fog').onChange(needsUpdate(material));
    return folder;
}

// MeshPhysicalMaterial extends MeshStandardMaterial with clearcoat/transmission.
function guiMeshPhysicalMaterial(gui, material) {
    const folder = guiMeshStandardMaterial(gui, material);
    folder.title('THREE.MeshPhysicalMaterial');
    folder.add(material, 'ior', 1, 2.333).step(0.01);
    folder.add(material, 'reflectivity', 0, 1).step(0.01);
    folder.add(material, 'clearcoat', 0, 1).step(0.01);
    folder.add(material, 'clearcoatRoughness', 0, 1).step(0.01);
    folder.add(material, 'transmission', 0, 1).step(0.01);
    folder.add(material, 'thickness', 0, 5).step(0.01);
    return folder;
}

// Glass/plastic preset (still a MeshPhysicalMaterial under the hood) — adds
// the normal-map controls from the Codrops technique on top of the base
// physical folder above.
function guiMeshGlassMaterial(gui, material) {
    const folder = guiMeshPhysicalMaterial(gui, material);
    folder.title('MeshGlassMaterial');

    // normalScale/clearcoatNormalScale are Vector2s and the shared noise
    // texture's repeat isn't a plain material property — proxy scalars,
    // same pattern the reference sandbox uses.
    const normalData = {
        normalScale: material.normalScale.x,
        clearcoatNormalScale: material.clearcoatNormalScale.x,
        normalRepeat: material.normalMap ? material.normalMap.repeat.x : 3
    };
    folder.add(normalData, 'normalScale', 0, 2, 0.01).onChange(v => material.normalScale.set(v, v));
    folder.add(normalData, 'clearcoatNormalScale', 0, 2, 0.01).onChange(v => material.clearcoatNormalScale.set(v, v));
    folder.add(normalData, 'normalRepeat', 1, 8, 1).onChange(v => {
        if (material.normalMap) material.normalMap.repeat.set(v, v);
    });
    return folder;
}

// MeshWaterMaterial folder — physical-material water (see
// createWaterMaterial()). waterColor drives attenuationColor (Beer's-law
// tint); depth is attenuationDistance inverted into an intuitive
// "bigger = more tinted" slider; waveStrength/waveScale/waveSpeed drive the
// animated normal map.
function guiMeshWaterMaterial(gui, material) {
    const folder = gui.addFolder('MeshWaterMaterial');
    const data = {
        waterColor: material.attenuationColor.getHex(),
        depth: 1 / material.attenuationDistance,
        waveStrength: material.normalScale.x,
        waveScale: material.normalMap.repeat.x
    };

    folder.addColor(data, 'waterColor').onChange(handleColorChange(material.attenuationColor));
    folder.add(data, 'depth', 0.2, 10, 0.1).onChange(v => { material.attenuationDistance = 1 / v; });
    folder.add(material, 'roughness', 0, 1, 0.01);
    folder.add(material, 'ior', 1, 2.333, 0.001);
    folder.add(material, 'thickness', 0, 5, 0.01);
    folder.add(material, 'transmission', 0, 1, 0.01);
    folder.add(data, 'waveStrength', 0, 2, 0.01).onChange(v => material.normalScale.set(v, v));
    folder.add(data, 'waveScale', 0.5, 8, 0.5).onChange(v => material.normalMap.repeat.set(v, v));
    folder.add(material.userData, 'waveSpeed', 0, 0.5, 0.005);
    folder.add(material.userData, 'hoverRadius', 0.2, 6, 0.1).name('rippleRadius').onChange(v => {
        if (material.userData.shader) material.userData.shader.uniforms.uRippleRadius.value = v;
    });
    folder.add(material.userData, 'hoverStrength', 0, 3, 0.01).name('rippleStrength').onChange(v => {
        if (material.userData.shader) material.userData.shader.uniforms.uRippleStrength.value = v;
    });
    return folder;
}

// Base MeshStandardMaterial folder (the surface underneath the blades) plus
// a nested "Grass Blades" folder for the instanced grass mesh itself.
// Nesting means rebuildMaterialFolders' single folder.destroy() call tears
// down both when switching to a different type.
function guiFurGrassMaterial(gui, material, volume) {
    const folder = guiMeshStandardMaterial(gui, material);
    folder.title('FurGrassMaterial (surface)');

    const opts = volume.grassOptions;
    const grassFolder = folder.addFolder('Grass Blades');
    grassFolder.add(opts, 'density', 200, 10000, 100).onChange(() => updateGrass(volume));
    grassFolder.add(opts, 'bladeHeight', 0.02, 0.4, 0.005).onChange(() => updateGrass(volume));
    grassFolder.add(opts, 'windStrength', 0, 3, 0.01).onChange(v => {
        if (volume.grass) volume.grass.material.uniforms.uWindStrength.value = v;
    });
    grassFolder.addColor(opts, 'colorBottom').onChange(v => {
        if (volume.grass) volume.grass.material.uniforms.uColorBottom.value.set(v);
        material.color.set(v); // underlying surface stays matched to the blade base
    });
    grassFolder.addColor(opts, 'colorTop').onChange(v => {
        if (volume.grass) volume.grass.material.uniforms.uColorTop.value.set(v);
    });
    // combAngle/directionJitter change each blade's orientation, so they
    // need a regrow like density/bladeHeight do (baked into aQuat at
    // creation time, not a live uniform).
    grassFolder.add(opts, 'combAngle', 0, 360, 1).name('combAngle (°)').onChange(() => updateGrass(volume));
    grassFolder.add(opts, 'directionJitter', 0, 3.14, 0.01).onChange(() => updateGrass(volume));
    grassFolder.add(opts, 'hoverRadius', 0.05, 2, 0.01).onChange(v => {
        if (volume.grass) volume.grass.material.uniforms.uHoverRadius.value = v;
    });
    grassFolder.add(opts, 'hoverStrength', 0, 3, 0.01).onChange(v => {
        if (volume.grass) volume.grass.material.uniforms.uHoverStrength.value = v;
    });
    return folder;
}

// gradientMap omitted — same reasoning as the standard-material texture
// dropdowns above: no texture asset is ever loaded, so it'd be a dead
// dropdown stuck on 'none' forever.
function guiMeshToonMaterial(gui, material) {
    const data = { color: material.color.getHex() };
    const folder = gui.addFolder('THREE.MeshToonMaterial');
    folder.addColor(data, 'color').onChange(handleColorChange(material.color));
    folder.add(material, 'wireframe').onChange(needsUpdate(material));
    return folder;
}

main();
