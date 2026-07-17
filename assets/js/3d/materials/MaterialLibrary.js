import * as THREE from 'three';
import { APPEARANCE } from '../config.js';

// The only place that creates/caches materials and category colors.
export class MaterialLibrary {
    constructor(theme) {
        this.theme = theme;
        this.edgeColor = new THREE.Color(theme.text);
        this.bgColor = new THREE.Color(theme.bg);
        this._categoryColors = new Map(); // axisId -> Color[]
    }

    /** Deterministic HSL rainbow across a category axis, cached per axis id. */
    colorsFor(axis) {
        if (this._categoryColors.has(axis.id)) return this._categoryColors.get(axis.id);
        const colors = axis.categories.map((_, i) =>
            new THREE.Color().setHSL(i / axis.categories.length, APPEARANCE.colorSaturation, APPEARANCE.colorLightness));
        this._categoryColors.set(axis.id, colors);
        return colors;
    }

    /** Solid material for a project cube, tinted toward the theme background. */
    cubeMaterial(baseColor) {
        const color = baseColor.clone().lerp(this.bgColor, APPEARANCE.colorBgMix);
        return new THREE.MeshStandardMaterial({
            color, roughness: APPEARANCE.roughness, metalness: APPEARANCE.metalness
        });
    }

    edgeMaterial(opacity = APPEARANCE.edgeOpacity) {
        return new THREE.LineBasicMaterial({ color: this.edgeColor, transparent: true, opacity });
    }

    boundsMaterial() {
        return this.edgeMaterial(APPEARANCE.boundsOpacity);
    }

    labelMaterial(texture) {
        return new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
    }
}
