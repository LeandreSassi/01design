import * as THREE from 'three';
import { GUI } from 'lil-gui';

// Dev-only material lab: attaches a lil-gui material editor directly onto
// the REAL running matrix (real scene, real lighting, real project meshes)
// instead of maintaining a separate cloned scene to test materials in.
// Activated by ?dev=1 (see the dynamic import in main.js) so regular
// visitors never load any of this.
//
// initMaterialLab({ viewport, ambientLight, sunLight, meshes }) wires up:
//   - a PMREM env map (for glass/water reflections — the real site doesn't
//     have one since production materials don't need it)
//   - the "Selected" folder + material-type dropdown + per-type param
//     folders (same material presets as before: standard/physical/glass/
//     toon/grass/water)
//   - grass + water-splash particle reactivity (hover/click) across every
//     managed mesh, not just the selected one
//   - a single auto-saving JSON snapshot per project id (localStorage) —
//     reselecting the same real cube later in the same browser restores
//     whatever you left it at
// It returns { select(mesh), deselect() } — main.js calls select() from its
// existing click handler when dev mode is on, instead of opening the modal.

const SIDE = {
    'THREE.FrontSide': THREE.FrontSide,
    'THREE.BackSide': THREE.BackSide,
    'THREE.DoubleSide': THREE.DoubleSide
};
const SELECTION_COLOR = 0x222222;

function createNoiseNormalTexture(size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = 128 + (Math.random() * 2 - 1) * 24;
        image.data[i + 1] = 128 + (Math.random() * 2 - 1) * 24;
        image.data[i + 2] = 255;
        image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    return texture;
}
const NORMAL_MAP = createNoiseNormalTexture();

// --- Water (see https://github.com/matsuoka-601/waterball for the source
// technique this is adapted from — MeshPhysicalMaterial transmission +
// attenuation IS its Beer's-law/fresnel/specular shading model already;
// only the animated wave normal map is bespoke here) ---
function createWaterNormalTexture(size = 256) {
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
    texture.repeat.set(2, 2);
    return texture;
}

function createWaterMaterial() {
    const waveMap = createWaterNormalTexture();
    const material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, roughness: 0.05, metalness: 0,
        transmission: 1, ior: 1.33, thickness: 1.5,
        attenuationColor: new THREE.Color(0x1fa9c9), attenuationDistance: 0.5,
        normalMap: waveMap, normalScale: new THREE.Vector2(0.6, 0.6)
    });
    material.userData.isWater = true;
    material.userData.waveSpeed = 0.06;
    material.userData.hoverRadius = 2.5;
    material.userData.hoverStrength = 0.8;

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
    MeshGlassMaterial: color => new THREE.MeshPhysicalMaterial({
        color, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, transmission: 1, thickness: 1,
        normalMap: NORMAL_MAP, normalScale: new THREE.Vector2(0.3, 0.3),
        clearcoatNormalMap: NORMAL_MAP, clearcoatNormalScale: new THREE.Vector2(0.2, 0.2)
    }),
    MeshToonMaterial: color => new THREE.MeshToonMaterial({ color }),
    FurGrassMaterial: color => new THREE.MeshStandardMaterial({ color, roughness: 1 }),
    MeshWaterMaterial: () => createWaterMaterial()
};

// Deliberately bright, no dark regions — clearcoat mirrors this almost
// perfectly at grazing angles, and a dark environment shows up as a black
// silhouette rim (see git history if you're wondering why this isn't
// RoomEnvironment).
function createEnvironmentScene() {
    const scene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(50, 32, 32);
    const top = new THREE.Color(0xffffff);
    const bottom = new THREE.Color(0xcfcac2);
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

// --- Grass (see https://github.com/FeliDipi/Grass for the source technique
// — instanced blades, per-instance offset/scale/phase/quaternion) ---
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
            a.x * w + b.x * u + c.x * v, a.y * w + b.y * u + c.y * v, a.z * w + b.z * u + c.z * v
        );
        const normal = new THREE.Vector3(
            na.x * w + nb.x * u + nc.x * v, na.y * w + nb.y * u + nc.y * v, na.z * w + nb.z * u + nc.z * v
        ).normalize();

        points.push({ position, normal });
    }
    return points;
}

const BLADE_GEOMETRY = (() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.008, 0, 0, 0.008, 0, 0, 0, 1, 0
    ], 3));
    return geometry;
})();
const UP_AXIS = new THREE.Vector3(0, 1, 0);

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

function defaultGrassOptions() {
    return {
        density: 8000, bladeHeight: 0.12, windStrength: 0.6,
        colorBottom: '#1e3a1e', colorTop: '#6fbf73',
        combAngle: 0, directionJitter: 0.3,
        hoverRadius: 0.6, hoverStrength: 1.2
    };
}

function updateGrass(entry) {
    if (entry.grass) {
        entry.mesh.remove(entry.grass);
        entry.grass.geometry.dispose();
        entry.grass.material.dispose();
        entry.grass = null;
    }
    if (entry.materialTypeName === 'FurGrassMaterial') {
        entry.mesh.material.color.set(entry.grassOptions.colorBottom);
        const points = sampleSurfacePoints(entry.mesh.geometry, entry.grassOptions.density);
        entry.grass = createGrassMesh(points, entry.grassOptions);
        entry.mesh.add(entry.grass);
    }
}

// --- Generic instanced-particle system (see createWaterSplash below) ---
function createParticleSystem(viewport, config) {
    const { geometry, material, poolSize, gravity = 0, drag = 0, orient = 'velocity', stretch = false, sizeCurve = t => t } = config;

    const mesh = new THREE.InstancedMesh(geometry, material, poolSize);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    viewport.add(mesh);

    const particles = Array.from({ length: poolSize }, () => ({
        position: new THREE.Vector3(), velocity: new THREE.Vector3(),
        orientation: new THREE.Quaternion(), life: 0, maxLife: 1, baseSize: 1
    }));
    let nextIndex = 0;
    const matrix = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
    const travelDir = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);

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

function createWaterSplash(viewport) {
    const dropletGeometry = new THREE.IcosahedronGeometry(1, 1);
    const dropletMaterial = new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.05, metalness: 0,
        transmission: 0.9, thickness: 0.3, ior: 1.33, transparent: true
    });
    const droplets = createParticleSystem(viewport, {
        geometry: dropletGeometry, material: dropletMaterial, poolSize: 200,
        gravity: 5, drag: 0.4, orient: 'velocity', stretch: true, sizeCurve: t => t
    });

    const ringGeometry = new THREE.RingGeometry(0.7, 1, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false
    });
    const rings = createParticleSystem(viewport, {
        geometry: ringGeometry, material: ringMaterial, poolSize: 12,
        gravity: 0, drag: 0, orient: 'fixed', stretch: false,
        sizeCurve: t => t < 0.7 ? THREE.MathUtils.lerp(0.2, 1, 1 - t / 0.7) : THREE.MathUtils.lerp(1, 0, (t - 0.7) / 0.3)
    });

    function spawn(origin, normal, color, big) {
        droplets.spawn(origin, normal, color, big ? 45 : 4, {
            speedMin: big ? 1.4 : 0.5, speedMax: big ? 3.2 : 1.1,
            spread: big ? 2.2 : 0.8, upBoost: big ? 2.4 : 0.9,
            lifeMin: 0.3, lifeMax: big ? 0.8 : 0.5,
            sizeMin: 0.012, sizeMax: big ? 0.035 : 0.022
        });
        if (big) rings.spawn(origin, normal, color, 1, { lifeMin: 0.35, lifeMax: 0.35, sizeMin: 0.9, sizeMax: 0.9 });
    }

    function update(dt) {
        droplets.update(dt);
        rings.update(dt);
    }

    return { spawn, update };
}

// --- Autosave: one JSON blob in localStorage, keyed by project id, so each
// real cube you've edited this browser keeps its own state until you change
// it again — but nothing here is ever read by production code (dev-local
// only, per the whole point of this being a *lab*). ---
const AUTOSAVE_KEY = 'materialLabAutosave';

function loadAutosave() {
    try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY)) || {}; }
    catch { return {}; }
}
function saveAutosave(data) {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
}

function sideName(value) {
    return Object.keys(SIDE).find(k => SIDE[k] === value) || 'THREE.FrontSide';
}
function assignIfDefined(target, data, keys) {
    keys.forEach(k => { if (data[k] !== undefined) target[k] = data[k]; });
}
function captureBase(material) {
    return {
        transparent: material.transparent, opacity: material.opacity,
        depthTest: material.depthTest, depthWrite: material.depthWrite,
        visible: material.visible, side: sideName(material.side)
    };
}
function applyBase(material, data) {
    assignIfDefined(material, data, ['transparent', 'opacity', 'depthTest', 'depthWrite', 'visible']);
    if (data.side) material.side = SIDE[data.side] ?? material.side;
}

const PRESET_HANDLERS = {
    MeshStandardMaterial: {
        capture: m => ({
            ...captureBase(m),
            color: '#' + m.color.getHexString(), emissive: '#' + m.emissive.getHexString(),
            roughness: m.roughness, metalness: m.metalness, envMapIntensity: m.envMapIntensity,
            flatShading: m.flatShading, wireframe: m.wireframe, fog: m.fog
        }),
        apply: (m, d) => {
            applyBase(m, d);
            if (d.color) m.color.set(d.color);
            if (d.emissive) m.emissive.set(d.emissive);
            assignIfDefined(m, d, ['roughness', 'metalness', 'envMapIntensity', 'flatShading', 'wireframe', 'fog']);
        }
    },
    MeshPhysicalMaterial: {
        capture: m => ({
            ...PRESET_HANDLERS.MeshStandardMaterial.capture(m),
            ior: m.ior, reflectivity: m.reflectivity, clearcoat: m.clearcoat,
            clearcoatRoughness: m.clearcoatRoughness, transmission: m.transmission, thickness: m.thickness
        }),
        apply: (m, d) => {
            PRESET_HANDLERS.MeshStandardMaterial.apply(m, d);
            assignIfDefined(m, d, ['ior', 'reflectivity', 'clearcoat', 'clearcoatRoughness', 'transmission', 'thickness']);
        }
    },
    MeshGlassMaterial: {
        capture: m => ({
            ...PRESET_HANDLERS.MeshPhysicalMaterial.capture(m),
            normalScale: m.normalScale.x, clearcoatNormalScale: m.clearcoatNormalScale.x,
            normalRepeat: m.normalMap ? m.normalMap.repeat.x : 3
        }),
        apply: (m, d) => {
            PRESET_HANDLERS.MeshPhysicalMaterial.apply(m, d);
            if (d.normalScale != null) m.normalScale.set(d.normalScale, d.normalScale);
            if (d.clearcoatNormalScale != null) m.clearcoatNormalScale.set(d.clearcoatNormalScale, d.clearcoatNormalScale);
            if (d.normalRepeat != null && m.normalMap) m.normalMap.repeat.set(d.normalRepeat, d.normalRepeat);
        }
    },
    MeshToonMaterial: {
        capture: m => ({ ...captureBase(m), color: '#' + m.color.getHexString(), wireframe: m.wireframe }),
        apply: (m, d) => { applyBase(m, d); if (d.color) m.color.set(d.color); assignIfDefined(m, d, ['wireframe']); }
    },
    MeshWaterMaterial: {
        capture: m => ({
            ...captureBase(m),
            waterColor: '#' + m.attenuationColor.getHexString(), depth: 1 / m.attenuationDistance,
            roughness: m.roughness, ior: m.ior, thickness: m.thickness, transmission: m.transmission,
            waveStrength: m.normalScale.x, waveScale: m.normalMap.repeat.x, waveSpeed: m.userData.waveSpeed,
            hoverRadius: m.userData.hoverRadius, hoverStrength: m.userData.hoverStrength
        }),
        apply: (m, d) => {
            applyBase(m, d);
            if (d.waterColor) m.attenuationColor.set(d.waterColor);
            if (d.depth != null) m.attenuationDistance = 1 / d.depth;
            assignIfDefined(m, d, ['roughness', 'ior', 'thickness', 'transmission']);
            if (d.waveStrength != null) m.normalScale.set(d.waveStrength, d.waveStrength);
            if (d.waveScale != null) m.normalMap.repeat.set(d.waveScale, d.waveScale);
            if (d.waveSpeed != null) m.userData.waveSpeed = d.waveSpeed;
            if (d.hoverRadius != null) {
                m.userData.hoverRadius = d.hoverRadius;
                if (m.userData.shader) m.userData.shader.uniforms.uRippleRadius.value = d.hoverRadius;
            }
            if (d.hoverStrength != null) {
                m.userData.hoverStrength = d.hoverStrength;
                if (m.userData.shader) m.userData.shader.uniforms.uRippleStrength.value = d.hoverStrength;
            }
        }
    },
    FurGrassMaterial: {
        capture: m => ({ ...captureBase(m), color: '#' + m.color.getHexString() }),
        apply: (m, d) => { applyBase(m, d); if (d.color) m.color.set(d.color); }
    }
};

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

export async function initMaterialLab({ viewport, ambientLight, sunLight, meshes }) {
    const pmremGenerator = new THREE.PMREMGenerator(viewport.renderer);
    viewport.scene.environment = pmremGenerator.fromScene(createEnvironmentScene(), 0.04).texture;
    pmremGenerator.dispose();

    const gui = new GUI({ title: 'Material Lab' });
    const autosave = loadAutosave();

    // One "entry" per real mesh, created lazily on first selection and
    // reused after that (so grass/materialTypeName/etc. survive reselection).
    const entries = new Map(); // mesh -> entry
    function entryFor(mesh) {
        if (entries.has(mesh)) return entries.get(mesh);
        const marker = createSelectionMarker(mesh.geometry);
        marker.position.add(mesh.position);
        viewport.add(marker);
        const entry = {
            id: mesh.userData.id, name: mesh.userData.title || mesh.userData.id || 'mesh',
            mesh, marker, materialTypeName: 'MeshStandardMaterial', grass: null,
            grassOptions: defaultGrassOptions()
        };
        entries.set(mesh, entry);

        const saved = entry.id && autosave[entry.id];
        if (saved) applyPreset(entry, saved);
        return entry;
    }

    function capturePreset(entry) {
        const type = entry.materialTypeName;
        const handler = PRESET_HANDLERS[type] || PRESET_HANDLERS.MeshStandardMaterial;
        const data = handler.capture(entry.mesh.material);
        if (type === 'FurGrassMaterial') data.grassOptions = { ...entry.grassOptions };
        return { type, data };
    }

    function applyPreset(entry, preset) {
        const old = entry.mesh.material;
        entry.materialTypeName = preset.type;
        const seedColor = preset.data.color ? new THREE.Color(preset.data.color) : getMaterialColor(old).clone();
        entry.mesh.material = MATERIAL_TYPES[preset.type](seedColor);
        old.dispose();
        const handler = PRESET_HANDLERS[preset.type] || PRESET_HANDLERS.MeshStandardMaterial;
        handler.apply(entry.mesh.material, preset.data);
        if (preset.type === 'FurGrassMaterial' && preset.data.grassOptions) {
            Object.assign(entry.grassOptions, preset.data.grassOptions);
        }
        updateGrass(entry);
    }

    function persist(entry) {
        if (!entry.id) return;
        autosave[entry.id] = capturePreset(entry);
        saveAutosave(autosave);
    }

    // --- GUI: Scene/Sun wired to the REAL lights, not duplicates ---
    const sceneFolder = gui.addFolder('Scene');
    const sceneData = { 'ambient light': ambientLight.color.getHex() };
    sceneFolder.addColor(sceneData, 'ambient light').onChange(handleColorChange(ambientLight.color));

    if (sunLight) {
        const sunFolder = gui.addFolder('Sun');
        const sunData = { color: sunLight.color.getHex() };
        sunFolder.addColor(sunData, 'color').onChange(handleColorChange(sunLight.color));
        sunFolder.add(sunLight, 'intensity', 0, 5, 0.01);
    }

    const selectionFolder = gui.addFolder('Selected: none');
    const typeProxy = { type: 'MeshStandardMaterial' };
    let selected = null;
    let materialFolder = null;
    let specificFolder = null;

    const typeController = selectionFolder.add(typeProxy, 'type', Object.keys(MATERIAL_TYPES)).onChange(name => {
        if (!selected) return;
        const old = selected.mesh.material;
        selected.materialTypeName = name;
        selected.mesh.material = MATERIAL_TYPES[name](getMaterialColor(old).clone());
        old.dispose();
        updateGrass(selected);
        rebuildMaterialFolders();
        persist(selected);
    });

    function rebuildMaterialFolders() {
        if (materialFolder) materialFolder.destroy();
        if (specificFolder) specificFolder.destroy();
        const label = selected.materialTypeName === 'FurGrassMaterial' ? 'THREE.Material (surface only, not blades)' : 'THREE.Material';
        materialFolder = guiMaterialBase(gui, selected.mesh.material, label, () => persist(selected));
        specificFolder = guiMaterialSpecific(gui, selected.mesh.material, selected.materialTypeName, selected, () => persist(selected));
    }

    function select(mesh) {
        const entry = entryFor(mesh);
        if (selected) selected.marker.visible = false;
        selected = entry;
        selected.marker.visible = true;

        selectionFolder.title('Selected: ' + entry.name);
        typeProxy.type = entry.materialTypeName;
        typeController.updateDisplay();
        rebuildMaterialFolders();
    }

    function deselect() {
        if (!selected) return;
        selected.marker.visible = false;
        selected = null;
        selectionFolder.title('Selected: none');
        if (materialFolder) { materialFolder.destroy(); materialFolder = null; }
        if (specificFolder) { specificFolder.destroy(); specificFolder = null; }
    }

    const autosaveFolder = gui.addFolder('Autosave');
    autosaveFolder.add({ clear: () => {
        if (!selected || !selected.id) return;
        delete autosave[selected.id];
        saveAutosave(autosave);
    } }, 'clear').name('Clear this project\'s autosave');
    autosaveFolder.add({ export: () => {
        const blob = new Blob([JSON.stringify(autosave, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'material-lab-autosave.json';
        a.click();
        URL.revokeObjectURL(url);
    } }, 'export').name('Export JSON');

    // --- Particle reactivity across every managed mesh (not just selected) ---
    const waterSplash = createWaterSplash(viewport);
    let lastTrickleTime = 0;
    const raycaster = new THREE.Raycaster();
    const hoverLocalPoint = new THREE.Vector3();

    window.addEventListener('pointermove', e => {
        const pointer = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(pointer, viewport.camera);

        const grassEntries = [...entries.values()].filter(v => v.grass);
        if (grassEntries.length) {
            const hit = raycaster.intersectObjects(grassEntries.map(v => v.mesh))[0];
            grassEntries.forEach(v => {
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

        const waterEntries = [...entries.values()].filter(v => v.mesh.material.userData.isWater && v.mesh.material.userData.shader);
        if (waterEntries.length) {
            const hit = raycaster.intersectObjects(waterEntries.map(v => v.mesh))[0];
            waterEntries.forEach(v => {
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

            const now = performance.now();
            if (hit && now - lastTrickleTime > 90) {
                lastTrickleTime = now;
                const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
                waterSplash.spawn(hit.point, worldNormal, hit.object.material.attenuationColor, false);
            }
        }
    });

    viewport.onFrame((() => {
        let lastFrameTime = performance.now() / 1000;
        return () => {
            const t = performance.now() / 1000;
            const dt = Math.min(t - lastFrameTime, 0.1);
            lastFrameTime = t;
            entries.forEach(v => {
                if (v.grass) v.grass.material.uniforms.uTime.value = t;
                const m = v.mesh.material;
                if (m.userData.isWater && m.normalMap) {
                    const s = m.userData.waveSpeed;
                    m.normalMap.offset.set(t * s + 0.3 * Math.sin(t * s * 4.7), t * s * 0.6 + 0.3 * Math.cos(t * s * 3.1));
                    if (m.userData.shader) m.userData.shader.uniforms.uRippleTime.value = t;
                }
            });
            waterSplash.update(dt);
        };
    })());

    window.addEventListener('keydown', e => {
        if (e.key === 'Escape') deselect();
    });

    // Splash on click needs the world hit point/normal main.js already has
    // from its own raycast — exposed via select() below so main.js's
    // existing click handler can pass them through in one call.
    function selectWithHit(mesh, hitPoint, hitFaceNormal) {
        if (mesh.material.userData.isWater && hitPoint && hitFaceNormal) {
            const worldNormal = hitFaceNormal.clone().transformDirection(mesh.matrixWorld);
            waterSplash.spawn(hitPoint, worldNormal, mesh.material.attenuationColor, true);
        }
        select(mesh);
    }

    if (meshes) meshes.forEach(m => void 0); // meshes are only wrapped lazily on first select; nothing to do eagerly

    return { select: selectWithHit, deselect };
}

// --- GUI folders (persist() is called after every change so the
// autosave stays current) ---
function guiMaterialBase(gui, material, label, persist) {
    const folder = gui.addFolder(label);
    folder.add(material, 'transparent').onChange(() => { needsUpdate(material)(); persist(); });
    folder.add(material, 'opacity', 0, 1).step(0.01).onChange(persist);
    folder.add(material, 'depthTest').onChange(persist);
    folder.add(material, 'depthWrite').onChange(persist);
    folder.add(material, 'visible').onChange(persist);
    folder.add(material, 'side', SIDE).onChange(() => { needsUpdate(material)(); persist(); });
    return folder;
}

function guiMaterialSpecific(gui, material, typeName, entry, persist) {
    if (typeName === 'MeshToonMaterial') return guiMeshToonMaterial(gui, material, persist);
    if (typeName === 'MeshGlassMaterial') return guiMeshGlassMaterial(gui, material, persist);
    if (typeName === 'MeshPhysicalMaterial') return guiMeshPhysicalMaterial(gui, material, persist);
    if (typeName === 'FurGrassMaterial') return guiFurGrassMaterial(gui, material, entry, persist);
    if (typeName === 'MeshWaterMaterial') return guiMeshWaterMaterial(gui, material, persist);
    return guiMeshStandardMaterial(gui, material, persist);
}

function guiMeshStandardMaterial(gui, material, persist) {
    const data = { color: material.color.getHex(), emissive: material.emissive.getHex() };
    const folder = gui.addFolder('THREE.MeshStandardMaterial');
    folder.addColor(data, 'color').onChange(v => { handleColorChange(material.color)(v); persist(); });
    folder.addColor(data, 'emissive').onChange(v => { handleColorChange(material.emissive)(v); persist(); });
    folder.add(material, 'roughness', 0, 1).onChange(persist);
    folder.add(material, 'metalness', 0, 1).onChange(persist);
    folder.add(material, 'envMapIntensity', 0, 3, 0.01).onChange(persist);
    folder.add(material, 'flatShading').onChange(() => { needsUpdate(material)(); persist(); });
    folder.add(material, 'wireframe').onChange(() => { needsUpdate(material)(); persist(); });
    folder.add(material, 'fog').onChange(() => { needsUpdate(material)(); persist(); });
    return folder;
}

function guiMeshPhysicalMaterial(gui, material, persist) {
    const folder = guiMeshStandardMaterial(gui, material, persist);
    folder.title('THREE.MeshPhysicalMaterial');
    folder.add(material, 'ior', 1, 2.333).step(0.01).onChange(persist);
    folder.add(material, 'reflectivity', 0, 1).step(0.01).onChange(persist);
    folder.add(material, 'clearcoat', 0, 1).step(0.01).onChange(persist);
    folder.add(material, 'clearcoatRoughness', 0, 1).step(0.01).onChange(persist);
    folder.add(material, 'transmission', 0, 1).step(0.01).onChange(persist);
    folder.add(material, 'thickness', 0, 5).step(0.01).onChange(persist);
    return folder;
}

function guiMeshGlassMaterial(gui, material, persist) {
    const folder = guiMeshPhysicalMaterial(gui, material, persist);
    folder.title('MeshGlassMaterial');
    const normalData = {
        normalScale: material.normalScale.x,
        clearcoatNormalScale: material.clearcoatNormalScale.x,
        normalRepeat: material.normalMap ? material.normalMap.repeat.x : 3
    };
    folder.add(normalData, 'normalScale', 0, 2, 0.01).onChange(v => { material.normalScale.set(v, v); persist(); });
    folder.add(normalData, 'clearcoatNormalScale', 0, 2, 0.01).onChange(v => { material.clearcoatNormalScale.set(v, v); persist(); });
    folder.add(normalData, 'normalRepeat', 1, 8, 1).onChange(v => {
        if (material.normalMap) material.normalMap.repeat.set(v, v);
        persist();
    });
    return folder;
}

function guiMeshWaterMaterial(gui, material, persist) {
    const folder = gui.addFolder('MeshWaterMaterial');
    const data = {
        waterColor: material.attenuationColor.getHex(),
        depth: 1 / material.attenuationDistance,
        waveStrength: material.normalScale.x,
        waveScale: material.normalMap.repeat.x
    };
    folder.addColor(data, 'waterColor').onChange(v => { handleColorChange(material.attenuationColor)(v); persist(); });
    folder.add(data, 'depth', 0.2, 10, 0.1).onChange(v => { material.attenuationDistance = 1 / v; persist(); });
    folder.add(material, 'roughness', 0, 1, 0.01).onChange(persist);
    folder.add(material, 'ior', 1, 2.333, 0.001).onChange(persist);
    folder.add(material, 'thickness', 0, 5, 0.01).onChange(persist);
    folder.add(material, 'transmission', 0, 1, 0.01).onChange(persist);
    folder.add(data, 'waveStrength', 0, 2, 0.01).onChange(v => { material.normalScale.set(v, v); persist(); });
    folder.add(data, 'waveScale', 0.5, 8, 0.5).onChange(v => { material.normalMap.repeat.set(v, v); persist(); });
    folder.add(material.userData, 'waveSpeed', 0, 0.5, 0.005).onChange(persist);
    folder.add(material.userData, 'hoverRadius', 0.2, 6, 0.1).name('rippleRadius').onChange(v => {
        material.userData.hoverRadius = v;
        if (material.userData.shader) material.userData.shader.uniforms.uRippleRadius.value = v;
        persist();
    });
    folder.add(material.userData, 'hoverStrength', 0, 3, 0.01).name('rippleStrength').onChange(v => {
        material.userData.hoverStrength = v;
        if (material.userData.shader) material.userData.shader.uniforms.uRippleStrength.value = v;
        persist();
    });
    return folder;
}

function guiFurGrassMaterial(gui, material, entry, persist) {
    const folder = guiMeshStandardMaterial(gui, material, persist);
    folder.title('FurGrassMaterial (surface)');
    const opts = entry.grassOptions;
    const grassFolder = folder.addFolder('Grass Blades');
    grassFolder.add(opts, 'density', 200, 10000, 100).onChange(() => { updateGrass(entry); persist(); });
    grassFolder.add(opts, 'bladeHeight', 0.02, 0.4, 0.005).onChange(() => { updateGrass(entry); persist(); });
    grassFolder.add(opts, 'windStrength', 0, 3, 0.01).onChange(v => {
        if (entry.grass) entry.grass.material.uniforms.uWindStrength.value = v;
        persist();
    });
    grassFolder.addColor(opts, 'colorBottom').onChange(v => {
        if (entry.grass) entry.grass.material.uniforms.uColorBottom.value.set(v);
        material.color.set(v);
        persist();
    });
    grassFolder.addColor(opts, 'colorTop').onChange(v => {
        if (entry.grass) entry.grass.material.uniforms.uColorTop.value.set(v);
        persist();
    });
    grassFolder.add(opts, 'combAngle', 0, 360, 1).name('combAngle (°)').onChange(() => { updateGrass(entry); persist(); });
    grassFolder.add(opts, 'directionJitter', 0, 3.14, 0.01).onChange(() => { updateGrass(entry); persist(); });
    grassFolder.add(opts, 'hoverRadius', 0.05, 2, 0.01).onChange(v => {
        if (entry.grass) entry.grass.material.uniforms.uHoverRadius.value = v;
        persist();
    });
    grassFolder.add(opts, 'hoverStrength', 0, 3, 0.01).onChange(v => {
        if (entry.grass) entry.grass.material.uniforms.uHoverStrength.value = v;
        persist();
    });
    return folder;
}

function guiMeshToonMaterial(gui, material, persist) {
    const data = { color: material.color.getHex() };
    const folder = gui.addFolder('THREE.MeshToonMaterial');
    folder.addColor(data, 'color').onChange(v => { handleColorChange(material.color)(v); persist(); });
    folder.add(material, 'wireframe').onChange(() => { needsUpdate(material)(); persist(); });
    return folder;
}
