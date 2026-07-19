import * as THREE from 'three';
import { BoxSpecBuilder } from '../geometry/BoxSpecBuilder.js';
import { buildSolidGeometry } from '../geometry/SolidGeometry.js';
import { buildOutlineGeometry } from '../geometry/OutlineGeometry.js';
import { applyOffset } from '../matrix/LaneLayout.js';
import { MATRIX, APPEARANCE } from '../config.js';

// Object creation: takes a resolved cell entry + layout + materials + this
// project's lane offset, and produces the actual THREE.Mesh. This is the
// only place that wires geometry (pure math) to a material (visual) inside
// a scene object.
//
// Every project builds at full MATRIX size — overlap between different
// projects is expected and fine (see ui/ScaleControl.js for the slider that
// controls how much they fuse). The lane offset just keeps projects sharing
// a cell visually distinct rather than perfectly coincident.
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
     * @param {{offset:number[]}} lane  this project's small (dx, dy, dz) spread nudge
     */
    create(entry, color, lane) {
        const { project, ix, iy, iz, members } = entry;
        const specs = applyOffset(this.specBuilder.build([ix, iy, iz], members), lane.offset);

        const geometry = buildSolidGeometry(specs);
        const material = this.materials.cubeMaterial(color);
        const mesh = new THREE.Mesh(geometry, material);

        const home = new THREE.Vector3(...this.layout.cellPosition(ix, iy, iz));
        mesh.position.copy(home);

        if (APPEARANCE.showProjectEdges) {
            mesh.add(new THREE.LineSegments(
                buildOutlineGeometry(geometry),
                this.materials.edgeMaterial()
            ));
        }

        mesh.userData = {
            kind: 'cube',
            id: project.id, title: project.title, thumb: project.thumb,
            home, ix, iy, iz, members,
            vy: 0, vx: 0, vz: 0, wx: 0, wz: 0,
            state: 'home', baseScale: 1, scale: 1
        };
        return mesh;
    }
}
