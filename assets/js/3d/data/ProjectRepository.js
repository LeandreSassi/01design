// Resolves raw projects.json entries into matrix cells, using the Taxonomy's
// axis order. Pure data — no three.js, no scene.
export class ProjectRepository {
    constructor(projects, taxonomy) {
        this.taxonomy = taxonomy;
        this.skipped = [];
        this.cells = this._resolve(projects);
    }

    static async load(taxonomy, url = 'projects.json') {
        const raw = await fetch(url).then(r => r.json());
        return new ProjectRepository(raw, taxonomy);
    }

    _resolve(projects) {
        const cellMap = new Map(); // "ix,iy,iz" -> [{ project, ix, iy, iz, members }]
        const { dimAxes } = this.taxonomy;

        projects.forEach(project => {
            const coord = dimAxes.map(axis => this.taxonomy.indexOf(axis, project));
            if (coord.some(i => i === -1)) { this.skipped.push(project.id); return; }

            const members = dimAxes.map(axis => this.taxonomy.membersOf(axis, project));
            const [ix, iy, iz] = coord;
            const key = coord.join(',');
            if (!cellMap.has(key)) cellMap.set(key, []);
            cellMap.get(key).push({ project, ix, iy, iz, members });
        });

        if (this.skipped.length) {
            console.warn('Not placed (missing axis tag):', this.skipped.join(', '));
        }
        return cellMap;
    }
}
