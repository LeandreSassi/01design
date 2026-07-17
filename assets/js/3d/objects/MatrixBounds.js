import * as THREE from 'three';

// The faint wireframe box outlining the whole matrix volume.
export function createMatrixBounds(extent, materials) {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(...extent));
    return new THREE.LineSegments(geometry, materials.boundsMaterial());
}
