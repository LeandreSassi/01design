import * as THREE from 'three';
import { BoxSpecBuilder } from '../geometry/BoxSpecBuilder.js';
import { buildSolidGeometry } from '../geometry/SolidGeometry.js';
import { buildOutlineGeometry } from '../geometry/OutlineGeometry.js';
import { MATRIX, APPEARANCE } from '../config.js';

// Object creation: takes a resolved cell entry + layout + materials, and
// produces the actual THREE.Mesh for a project. This is the only place that
// wires geometry (pure math) to a material (visual) inside a scene object.
export class ProjectObjectFactory {
    constructor(layout, materials) {
        this.layout = layout;
        this.materials = materials;
        this.specBuilder = new BoxSpecBuilder({
            cubeSize: MATRIX.cubeSize,
            spacing: MATRIX.spacing,
            connectorSize: MATRIX.connector,
            bridgeBite: MATRIX.bridgeBite
        });
    }

    /**
     * @param {object} entry  { project, ix, iy, iz, members }
     * @param {THREE.Color} color  base color for this project (already resolved)
     * @param {[number, number]} cellOffsetXZ  sub-cell offset when a cell is shared
     * @param {number} scale  base scale (shrunk when several projects share a cell)
     */
    create(entry, color, cellOffsetXZ, scale) {
        const { project, ix, iy, iz, members } = entry;
        const specs = this.specBuilder.build([ix, iy, iz], members);

        const geometry = buildSolidGeometry(specs);
        const material = this.materials.cubeMaterial(color);
        const mesh = new THREE.Mesh(geometry, material);

        const [hx, hy, hz] = this.layout.cellPosition(ix, iy, iz);
        const home = new THREE.Vector3(hx + cellOffsetXZ[0], hy, hz + cellOffsetXZ[1]);
        mesh.position.copy(home);
        mesh.scale.setScalar(scale);

        mesh.add(new THREE.LineSegments(
            buildOutlineGeometry(specs, APPEARANCE.outlineEps),
            this.materials.edgeMaterial()
        ));

        mesh.userData = {
            kind: 'cube',
            id: project.id, title: project.title, thumb: project.thumb,
            home, ix, iy, iz, members,
            vy: 0, vx: 0, vz: 0, wx: 0, wz: 0,
            state: 'home', baseScale: scale, scale
        };
        return mesh;
    }
}
