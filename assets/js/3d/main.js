import { readTheme } from './core/Theme.js';
import { Viewport } from './core/Viewport.js';
import { createLighting } from './core/Lighting.js';
import { Taxonomy } from './data/Taxonomy.js';
import { ProjectRepository } from './data/ProjectRepository.js';
import { MatrixLayout } from './matrix/MatrixLayout.js';
import { MaterialLibrary } from './materials/MaterialLibrary.js';
import { ProjectObjectFactory } from './objects/ProjectObject.js';
import { RowLabelFactory } from './objects/RowLabels.js';
import { createMatrixBounds } from './objects/MatrixBounds.js';
import { DropPhysics } from './animation/DropPhysics.js';
import { RowVisibility } from './interaction/RowVisibility.js';
import { Picker } from './interaction/Picker.js';
import { HoverPreview } from './ui/HoverPreview.js';
import { ProjectModal } from './ui/ProjectModal.js';
import { MATRIX } from './config.js';

async function main() {
    const theme = readTheme();
    const canvas = document.getElementById('scene');
    const viewport = new Viewport(canvas, { background: theme.bg });
    viewport.add(createLighting());

    const materials = new MaterialLibrary(theme);

    const taxonomy = await Taxonomy.load();
    const repo = await ProjectRepository.load(taxonomy);

    build(viewport, materials, taxonomy, repo);
}

function build(viewport, materials, taxonomy, repo) {
    const layout = new MatrixLayout(taxonomy.dims, MATRIX.spacing, MATRIX.cubeSize);
    const objectFactory = new ProjectObjectFactory(layout, materials);
    const labelFactory = new RowLabelFactory(materials, materials.theme.text);

    // Cube color follows the "subject" axis regardless of which dimension
    // (X/Y/Z) it currently occupies in DIMENSION_ORDER.
    const colorAxis = taxonomy.axis('subject');
    const colorDim = taxonomy.dimAxes.indexOf(colorAxis);
    const coordKeys = ['ix', 'iy', 'iz'];
    const categoryColors = materials.colorsFor(colorAxis);

    const projectMeshes = [];
    repo.cells.forEach(entries => {
        const offsets = MatrixLayout.subOffsets(entries.length, MATRIX.spacing);
        const scale = entries.length > 1 ? 0.48 : 1;
        entries.forEach((entry, j) => {
            const color = categoryColors[entry[coordKeys[colorDim]]];
            const mesh = objectFactory.create(entry, color, offsets[j], scale);
            viewport.add(mesh);
            projectMeshes.push(mesh);
        });
    });

    const extent = layout.extent(MATRIX.border);
    viewport.add(createMatrixBounds(extent, materials));

    const half = extent.map(e => e / 2);
    const M = MATRIX.labelMargin;
    const labelPosition = [
        i => [layout.axisCoord(i, taxonomy.dims[0]), -half[1], half[2] + M],
        i => [-half[0] - M, layout.axisCoord(i, taxonomy.dims[1]), half[2] + M - 1],
        i => [half[0] + M, -half[1], layout.axisCoord(i, taxonomy.dims[2])]
    ];
    const labelMeshes = [];
    taxonomy.dimAxes.forEach((axis, dim) => {
        axis.categories.forEach((cat, i) => {
            const [x, y, z] = labelPosition[dim](i);
            const label = labelFactory.create(cat.label, dim, i, { x, y, z });
            viewport.add(label);
            labelMeshes.push(label);
        });
    });

    const rowVisibility = new RowVisibility(taxonomy.dims, projectMeshes, labelMeshes);
    document.getElementById('reset-rows').addEventListener('click', () => rowVisibility.resetAll());

    const picker = new Picker(viewport.camera);
    const preview = new HoverPreview({
        tooltipEl: document.getElementById('tooltip'),
        previewEl: document.getElementById('hover-preview'),
        previewCardEl: document.getElementById('preview-card'),
        previewTitleEl: document.getElementById('preview-title')
    });
    const modal = new ProjectModal(document.getElementById('scene-modal-root'));

    window.addEventListener('pointermove', e => picker.setPointerFromEvent(e));
    viewport.canvas.addEventListener('click', () => {
        const h = picker.hovered;
        if (!h) return;
        if (h.userData.kind === 'cube') modal.open(h.userData.id);
        else rowVisibility.toggle(h.userData.axis, h.userData.index);
    });

    viewport.onFrame(() => {
        const { hovered, changed } = picker.update(projectMeshes, labelMeshes);
        if (changed) {
            if (hovered && hovered.userData.kind === 'cube') preview.showCube(hovered.userData);
            else if (hovered) preview.showLabel(hovered.userData);
            else preview.hide();
        }
        projectMeshes.forEach(mesh => {
            DropPhysics.step(mesh);
            DropPhysics.stepScale(mesh, mesh === hovered);
        });
    });

    projectMeshes.forEach(DropPhysics.dropIn);
    viewport.start();
}

main();
