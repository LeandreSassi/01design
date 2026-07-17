import * as THREE from 'three';
import { Brush, Evaluator, ADDITION } from 'three-bvh-csg';

// Boolean-unions a list of box specs into ONE true solid: internal faces
// vanish and coplanar surfaces fuse. This is the only file that touches CSG.
export function buildSolidGeometry(specs) {
    if (specs.length === 1) {
        const { size, off } = specs[0];
        return new THREE.BoxGeometry(size[0], size[1], size[2]).translate(off[0], off[1], off[2]);
    }

    const evaluator = new Evaluator();
    evaluator.useGroups = false;
    let union = null;

    specs.forEach(({ size, off }) => {
        const brush = new Brush(new THREE.BoxGeometry(size[0], size[1], size[2]));
        brush.position.set(off[0], off[1], off[2]);
        brush.updateMatrixWorld();
        union = union ? evaluator.evaluate(union, brush, ADDITION) : brush;
    });

    return union.geometry;
}
