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
// A tiny deterministic per-project displacement is also folded in here to
// stop z-fighting: neighbouring volumes sitting on the regular grid share
// perfectly aligned (coplanar) faces, which fight in the depth buffer. The
// nudge is derived from the project id (stable across reloads) and applied
// in geometry space — added to the box specs exactly like the lane offset,
// not via material polygonOffset — so the fix survives geometry rebuilds
// (dev/ParametricEngine.js) and any render path.

// Deterministic sub-visual (dx, dy, dz) displacement from a project id. Three
// FNV-1a hashes over the id, one per axis, each mapped to [-1, 1] * magnitude.
function zFightJitter(id, magnitude) {
    const axis = seed => {
        let h = seed;
        for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
        return ((h >>> 0) / 0xffffffff * 2 - 1) * magnitude;
    };
    return [axis(0x811c9dc5), axis(0x85ebca6b), axis(0xc2b2ae35)];
}
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
        const jitter = zFightJitter(project.id, MATRIX.zFightJitter);
        const spread = [
            lane.offset[0] + jitter[0],
            lane.offset[1] + jitter[1],
            lane.offset[2] + jitter[2]
        ];
        const specs = applyOffset(this.specBuilder.build([ix, iy, iz], members), spread);

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
            state: 'home', baseScale: 1, scale: 1,
            // The box specs this geometry was built from — kept around so
            // dev tools (see dev/ParametricEngine.js) can regenerate the
            // geometry with different params (corner radius, etc.) without
            // needing to recompute lane/footprint math from scratch.
            specs
        };
        return mesh;
    }
}
