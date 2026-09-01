import { readTheme } from './core/Theme.js';
import { Viewport } from './core/Viewport.js';
import { createLighting } from './core/Lighting.js';
import { Taxonomy } from './data/Taxonomy.js';
import { ProjectRepository } from './data/ProjectRepository.js';
import { MatrixLayout } from './matrix/MatrixLayout.js';
import { LaneAssignment } from './matrix/LaneAssignment.js';
import { laneSlot } from './matrix/LaneLayout.js';
import { MaterialLibrary } from './materials/MaterialLibrary.js';
import { ProjectObjectFactory } from './objects/ProjectObject.js';
import { RowLabelFactory } from './objects/RowLabels.js';
import { createMatrixBounds } from './objects/MatrixBounds.js';
import { createGroundWater, updateWaterHover } from './objects/GroundWater.js';
import { DropPhysics } from './animation/DropPhysics.js';
import { RowVisibility } from './interaction/RowVisibility.js';
import { Picker } from './interaction/Picker.js';
import { HoverPreview } from './ui/HoverPreview.js';
import { ProjectModal } from './ui/ProjectModal.js';
import { ScaleControl } from './ui/ScaleControl.js';
import { MATRIX } from './config.js';

// A nice, non-harsh white for the 3D canvas — independent of the site's
// teal --color-bg theme (Theme.js), which the surrounding page chrome
// (topbar, buttons) keeps using.
const SCENE_BG = '#F2EFE9';

async function main() {
    const theme = readTheme();
    const canvas = document.getElementById('scene');
    const viewport = new Viewport(canvas, { background: SCENE_BG });
    const lighting = createLighting();
    viewport.add(lighting);

    const materials = new MaterialLibrary(theme);

    const taxonomy = await Taxonomy.load();
    const repo = await ProjectRepository.load(taxonomy);

    build(viewport, materials, taxonomy, repo, lighting);
}

function build(viewport, materials, taxonomy, repo, lighting) {
    const layout = new MatrixLayout(taxonomy.dims, MATRIX.spacing, MATRIX.cubeSize);
    const objectFactory = new ProjectObjectFactory(layout, materials);
    const labelFactory = new RowLabelFactory(materials, materials.theme.text);

    // Cube color follows the "subject" axis regardless of which dimension
    // (X/Y/Z) it currently occupies in DIMENSION_ORDER.
    const colorAxis = taxonomy.axis('subject');
    const colorDim = taxonomy.dimAxes.indexOf(colorAxis);
    const coordKeys = ['ix', 'iy', 'iz'];
    const categoryColors = materials.colorsFor(colorAxis);

    // Every project renders at full size; overlap between different
    // projects is expected. Lanes just give projects sharing a cell a small
    // distinct nudge so they read as separate volumes rather than one
    // coincident blob — see matrix/LaneAssignment.js and LaneLayout.js.
    const allEntries = [...repo.cells.values()].flat();
    const laneEntries = allEntries.map(e => ({ id: e.project.id, members: e.members }));
    const lanes = new LaneAssignment(laneEntries);

    const projectMeshes = [];
    allEntries.forEach(entry => {
        const color = categoryColors[entry[coordKeys[colorDim]]];
        const { rank, count } = lanes.slotOf(entry.project.id);
        const lane = laneSlot(rank, count);
        const mesh = objectFactory.create(entry, color, lane);
        viewport.add(mesh);
        projectMeshes.push(mesh);
    });

    const extent = layout.extent(MATRIX.border);
    viewport.add(createMatrixBounds(extent, materials));

    const half = extent.map(e => e / 2);

    // Calm reflective water standing in for a ground plane, sitting right
    // under the matrix's bottom bound. Nudged down by zFightJitter — the X/Z
    // row labels below sit flat at exactly -half[1] too, so without this the
    // water plane is perfectly coplanar with them and z-fights.
    const sun = lighting.children.find(c => c.isDirectionalLight);
    const water = createGroundWater(sun.position.clone().normalize(), { y: -half[1] - MATRIX.zFightJitter });
    viewport.add(water);

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

    const scaleControl = new ScaleControl(document.getElementById('topbar'));

    const picker = new Picker(viewport.camera);
    const preview = new HoverPreview({
        tooltipEl: document.getElementById('tooltip'),
        previewEl: document.getElementById('hover-preview'),
        previewCardEl: document.getElementById('preview-card'),
        previewTitleEl: document.getElementById('preview-title')
    });
    const modal = new ProjectModal(document.getElementById('scene-modal-root'));

    // Dev mode (?dev=1): a material-editing lab bolted onto this same real
    // scene/lighting/project meshes — no separate cloned scene to keep in
    // sync. Lazily imported so regular visitors never load it. While active,
    // clicking a cube selects it for editing instead of opening its modal.
    let materialLab = null;
    if (new URLSearchParams(location.search).get('dev') === '1') {
        import('./dev/MaterialLab.js').then(({ initMaterialLab }) => initMaterialLab({
            viewport,
            ambientLight: lighting.children.find(c => c.isAmbientLight),
            sunLight: lighting.children.find(c => c.isDirectionalLight),
            meshes: projectMeshes
        })).then(lab => { materialLab = lab; });
    }

    window.addEventListener('pointermove', e => picker.setPointerFromEvent(e));
    viewport.canvas.addEventListener('click', () => {
        const h = picker.hovered;
        if (!h) return;
        if (h.userData.kind === 'cube') {
            if (materialLab) materialLab.select(h);
            else modal.open(h.userData.id);
        } else {
            rowVisibility.toggle(h.userData.axis, h.userData.index);
        }
    });

    let lastFrameTime = performance.now() / 1000;
    viewport.onFrame(() => {
        const t = performance.now() / 1000;
        const dt = Math.min(t - lastFrameTime, 0.1);
        lastFrameTime = t;

        const { hovered, changed } = picker.update(projectMeshes, labelMeshes);

        // Same ray picker.update() just cast, re-tested against the water —
        // a light ripple trail follows it, see GroundWater.js.
        const waterHit = picker.raycaster.intersectObject(water)[0];
        updateWaterHover(water, dt, waterHit ? { x: waterHit.point.x, z: waterHit.point.z } : null);

        if (changed) {
            if (hovered && hovered.userData.kind === 'cube') preview.showCube(hovered.userData);
            else if (hovered) preview.showLabel(hovered.userData);
            else preview.hide();
        }
        projectMeshes.forEach(mesh => {
            mesh.userData.baseScale = scaleControl.value;
            DropPhysics.step(mesh);
            DropPhysics.stepScale(mesh, mesh === hovered);
        });
    });

    projectMeshes.forEach(DropPhysics.dropIn);
    viewport.start();
}

main();
