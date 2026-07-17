import * as THREE from 'three';
import { APPEARANCE } from '../config.js';

// Builds the clickable row-name labels that sit along each axis of the matrix.
export class RowLabelFactory {
    constructor(materials, textColor) {
        this.materials = materials;
        this.textColor = textColor;
    }

    /** @returns {THREE.Mesh} a plane textured with the row's name, at `position`. */
    create(text, dim, index, position) {
        const canvas = this._renderTextCanvas(text);
        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 4;

        const s = APPEARANCE.labelScale;
        const geometry = new THREE.PlaneGeometry(canvas.width * s, canvas.height * s);

        // justify the plane so text grows away from the matrix, not through it
        if (dim === 0 || dim === 1) geometry.translate(-(canvas.width * s) / 2, 0, 0);
        else geometry.translate((canvas.width * s) / 2, 0, 0);

        const label = new THREE.Mesh(geometry, this.materials.labelMaterial(texture));
        label.position.copy(position);

        if (dim === 0) label.rotation.set(-Math.PI / 2, 0, Math.PI / 2);       // X axis
        else if (dim === 1) label.rotation.set(0, Math.PI / 4, 0);             // Y axis
        else label.rotation.set(Math.PI * 1.5, 0, 0);                          // Z axis

        label.userData = { kind: 'label', axis: dim, index, text };
        return label;
    }

    _renderTextCanvas(text) {
        const font = APPEARANCE.labelFontPx;
        const probe = document.createElement('canvas').getContext('2d');
        probe.font = `700 ${font}px 'Trebuchet MS', sans-serif`;

        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(probe.measureText(text).width);
        canvas.height = font;

        const ctx = canvas.getContext('2d');
        ctx.font = `700 ${font}px 'Trebuchet MS', sans-serif`;
        ctx.fillStyle = this.textColor;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, canvas.height / 2);
        return canvas;
    }
}
