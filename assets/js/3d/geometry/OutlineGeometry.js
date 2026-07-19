import * as THREE from 'three';

// Silhouette outline for a merged solid. Because the solid comes from a true
// CSG boolean union (see SolidGeometry.js), internal seams between the boxes
// are already gone from the mesh itself — adjacent faces at a former joint
// are coplanar and share topology, so a tight angle threshold naturally
// keeps only genuine exterior creases with no seam lines at articulations.
const CREASE_ANGLE_DEG = 1;

export function buildOutlineGeometry(solidGeometry) {
    return new THREE.EdgesGeometry(solidGeometry, CREASE_ANGLE_DEG);
}
