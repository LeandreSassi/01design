import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA } from '../config.js';

// Owns renderer + camera + controls + the render loop.
// Knows nothing about projects, matrices or materials.
export class Viewport {
    constructor(canvas, { background }) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(background);

        this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
        this.camera.position.set(...CAMERA.position);

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = CAMERA.dampingFactor;
        this.controls.autoRotate = false;
        this.controls.minDistance = CAMERA.minDistance;
        this.controls.maxDistance = CAMERA.maxDistance;

        // OrbitControls' own wheel zoom scales by |event.deltaY|, assuming
        // ~100px per notch. Some browser/mouse combos (notably Chrome on
        // Windows) report a far larger deltaY per notch than others (Edge),
        // making a single scroll dolly all the way to min/max. Drive zoom
        // ourselves off the *sign* of deltaY with a clamped magnitude, so one
        // notch is always one bounded step regardless of what the browser
        // reports — while still letting trackpads (small deltas) zoom smoothly.
        this.controls.enableZoom = false;
        this._initWheelZoom();

        this._tasks = [];
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    // Cross-browser wheel zoom. Normalizes deltaY to a fraction of one notch
    // (~100px), capped at 1, so a huge single event can't max out the zoom.
    // Adjusts the camera's distance to the orbit target directly; OrbitControls
    // re-derives its spherical state from the live camera position every
    // update(), so this composes cleanly with orbit + damping.
    _initWheelZoom() {
        const offset = new THREE.Vector3();
        this.canvas.addEventListener('wheel', e => {
            e.preventDefault();
            if (!this.controls.enabled) return;
            const intensity = Math.min(Math.abs(e.deltaY) / 100, 1);
            if (intensity === 0) return;
            const factor = Math.pow(CAMERA.zoomStep, -Math.sign(e.deltaY) * intensity);

            offset.copy(this.camera.position).sub(this.controls.target);
            const distance = THREE.MathUtils.clamp(
                offset.length() * factor, this.controls.minDistance, this.controls.maxDistance
            );
            offset.setLength(distance);
            this.camera.position.copy(this.controls.target).add(offset);
        }, { passive: false });
    }

    /** Register a per-frame callback. */
    onFrame(fn) { this._tasks.push(fn); }

    add(...objects) { this.scene.add(...objects); }

    start() {
        const loop = () => {
            requestAnimationFrame(loop);
            this._tasks.forEach(fn => fn());
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }

    _resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }
}
