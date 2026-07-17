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

        this._tasks = [];
        this._resize();
        window.addEventListener('resize', () => this._resize());
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
