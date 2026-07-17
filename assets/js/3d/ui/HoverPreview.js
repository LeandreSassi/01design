// Drives the DOM tooltip + mini project-card preview based on what's hovered.
export class HoverPreview {
    constructor({ tooltipEl, previewEl, previewCardEl, previewTitleEl }) {
        this.tooltip = tooltipEl;
        this.preview = previewEl;
        this.previewCard = previewCardEl;
        this.previewTitle = previewTitleEl;

        window.addEventListener('pointermove', e => {
            this.tooltip.style.left = e.clientX + 'px';
            this.tooltip.style.top = e.clientY + 'px';
        });
    }

    showCube(userData) {
        this.tooltip.textContent = userData.title;
        this.tooltip.style.opacity = '1';
        document.body.style.cursor = 'pointer';
        if (userData.thumb) {
            this.previewCard.style.backgroundImage = `url('${userData.thumb}')`;
            this.previewTitle.textContent = userData.title;
            this.preview.style.opacity = '1';
        }
    }

    showLabel(userData) {
        this.tooltip.textContent = 'toggle: ' + userData.text;
        this.tooltip.style.opacity = '1';
        document.body.style.cursor = 'pointer';
        this.preview.style.opacity = '0';
    }

    hide() {
        this.tooltip.style.opacity = '0';
        this.preview.style.opacity = '0';
        document.body.style.cursor = 'default';
    }
}
