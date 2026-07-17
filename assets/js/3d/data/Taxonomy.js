// The taxonomy: three meta-categories and how they map onto X / Y / Z.
//
// SINGLE SOURCE OF TRUTH for the axis order is DIMENSION_ORDER below.
// Reorder it and the entire matrix rotates — cells, spans, labels, toggles.
//   slot 0 -> X, slot 1 -> Y (vertical), slot 2 -> Z
export const DIMENSION_ORDER = ['language', 'subject', 'output'];

export class Taxonomy {
    constructor(raw, dimensionOrder = DIMENSION_ORDER) {
        this.axes = raw.axes;
        this.byId = Object.fromEntries(this.axes.map(a => [a.id, a]));
        /** axes in X, Y, Z order */
        this.dimAxes = dimensionOrder.map(id => {
            const axis = this.byId[id];
            if (!axis) throw new Error(`taxonomy.json has no axis "${id}"`);
            return axis;
        });
        /** number of rows per dimension, [x, y, z] */
        this.dims = this.dimAxes.map(a => a.categories.length);
    }

    static async load(url = 'taxonomy.json', dimensionOrder) {
        const raw = await fetch(url).then(r => r.json());
        return new Taxonomy(raw, dimensionOrder);
    }

    axis(id) { return this.byId[id]; }

    /** Index of the first category of `axis` that this project is tagged with. */
    indexOf(axis, project) {
        for (const tag of project.categories || []) {
            const k = axis.categories.findIndex(c => c.id === tag);
            if (k !== -1) return k;
        }
        return -1;
    }

    /** All category indices of `axis` this project belongs to, ascending. */
    membersOf(axis, project) {
        const found = [];
        (project.categories || []).forEach(tag => {
            const k = axis.categories.findIndex(c => c.id === tag);
            if (k !== -1 && !found.includes(k)) found.push(k);
        });
        return found.sort((a, b) => a - b);
    }
}
