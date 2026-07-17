import * as THREE from 'three';

// The standard three-point-ish rig for the matrix.
export function createLighting() {
    const group = new THREE.Group();
    group.add(new THREE.AmbientLight(0xffffff, 0.6));

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(8, 12, 6);
    group.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-6, 2, -8);
    group.add(fill);

    return group;
}
