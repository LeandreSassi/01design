import * as THREE from 'three';

// Raycasts the pointer against project meshes + labels and reports the
// currently hovered entity (walking up from a hit child segment to the
// owning object, since project meshes can have outline children).
export class Picker {
    constructor(camera) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.hovered = null;
    }

    setPointerFromEvent(e) {
        this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    }

    /** @returns {THREE.Object3D|null} the newly hovered object, or null if unchanged detection still applies */
    update(projectMeshes, labelMeshes) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const targets = [...projectMeshes.filter(m => m.visible), ...labelMeshes];
        const hits = this.raycaster.intersectObjects(targets, true);

        let hit = null;
        for (const h of hits) {
            let obj = h.object;
            while (obj && !(obj.userData && obj.userData.kind)) obj = obj.parent;
            if (obj) { hit = obj; break; }
        }

        const changed = hit !== this.hovered;
        this.hovered = hit;
        return { hovered: hit, changed };
    }
}
