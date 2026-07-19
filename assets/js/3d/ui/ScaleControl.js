import { SCALE } from '../config.js';

// Live scale slider: a plain mutable value the render loop reads every
// frame (see main.js), plus the DOM control that drives it. No geometry
// rebuild needed — scale is applied via mesh.scale, so dragging is instant.
export class ScaleControl {
    constructor(containerEl) {
        this.value = SCALE.default;

        const wrap = document.createElement('div');
        wrap.id = 'scale-control';

        const label = document.createElement('span');
        label.textContent = 'Scale';

        const input = document.createElement('input');
        input.type = 'range';
        input.min = SCALE.min;
        input.max = SCALE.max;
        input.step = SCALE.step;
        input.value = SCALE.default;
        input.addEventListener('input', () => { this.value = parseFloat(input.value); });

        wrap.appendChild(label);
        wrap.appendChild(input);
        containerEl.appendChild(wrap);
    }
}
