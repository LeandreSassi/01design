import { DropPhysics } from '../animation/DropPhysics.js';
import { APPEARANCE } from '../config.js';

// Owns which rows are shown/hidden per axis, and drives the drop/remove
// animation on project meshes + dimming on row labels in response.
export class RowVisibility {
    constructor(dims, projectMeshes, labelMeshes) {
        this.visible = dims.map(count => new Array(count).fill(true));
        this.meshes = projectMeshes;
        this.labels = labelMeshes;
    }

    /** A mesh shows if, on every axis, at least one of its member rows is on. */
    shouldShow(mesh) {
        const u = mesh.userData;
        return u.members.every((rows, axis) => rows.some(i => this.visible[axis][i]));
    }

    apply() {
        this.meshes.forEach(mesh => {
            const show = this.shouldShow(mesh);
            const state = mesh.userData.state;
            if (show && (state === 'hidden' || state === 'falling')) DropPhysics.dropIn(mesh);
            else if (!show && (state === 'home' || state === 'dropping')) DropPhysics.startRemove(mesh);
        });
    }

    toggle(axis, index) {
        this.visible[axis][index] = !this.visible[axis][index];
        const on = this.visible[axis][index];
        this.labels.forEach(label => {
            if (label.userData.axis === axis && label.userData.index === index) {
                label.material.opacity = on ? 1 : APPEARANCE.dimmedRowOpacity;
            }
        });
        this.apply();
    }

    resetAll() {
        this.visible.forEach(row => row.fill(true));
        this.labels.forEach(label => (label.material.opacity = 1));
        this.apply();
    }
}
