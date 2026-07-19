import { computeFootprint } from './Footprint.js';

// Assigns every project a lane such that two projects sharing any footprint
// cell are guaranteed different lanes — exact graph coloring from real
// footprints, not a heuristic.
//
// Coloring runs PER CONNECTED COMPONENT of the conflict graph, not globally.
// Two projects that never conflict — even transitively through a chain of
// other projects — belong to different components and can safely reuse the
// same small lane numbers with the same tight offsets, because they're
// nowhere near each other in the matrix regardless. This is what keeps
// sizing local: a 3-way cluster renders at "3-lane" size even if some other,
// unrelated cell elsewhere is a 5-way pile-up.
//
// Offsets within one component are drawn from two independently-permuted
// evenly-spaced sequences (see LaneLayout.js), so any two distinct lane
// numbers in the SAME component differ by at least one full step in both dx
// and dz — safe regardless of which axis a shape elongates along.
export class LaneAssignment {
    /** @param {{id:string, members:number[][]}[]} entries */
    constructor(entries) {
        const footprintById = new Map(entries.map(e => [e.id, computeFootprint(e.members)]));

        const cellOccupants = new Map();
        footprintById.forEach((cells, id) => {
            cells.forEach(cell => {
                if (!cellOccupants.has(cell)) cellOccupants.set(cell, []);
                cellOccupants.get(cell).push(id);
            });
        });

        const conflicts = new Map(entries.map(e => [e.id, new Set()]));
        cellOccupants.forEach(ids => {
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    conflicts.get(ids[i]).add(ids[j]);
                    conflicts.get(ids[j]).add(ids[i]);
                }
            }
        });

        const components = this._findComponents(entries.map(e => e.id), conflicts);

        this._slot = new Map();   // id -> { rank, count }
        components.forEach(component => {
            if (component.length === 1) {
                this._slot.set(component[0], { rank: 0, count: 1 });
                return;
            }
            const lane = new Map();
            [...component].sort((a, b) => a.localeCompare(b)).forEach(id => {
                const used = new Set([...conflicts.get(id)].map(n => lane.get(n)).filter(l => l !== undefined));
                let l = 0;
                while (used.has(l)) l++;
                lane.set(id, l);
            });
            const count = Math.max(...lane.values()) + 1;
            lane.forEach((rank, id) => this._slot.set(id, { rank, count }));
        });

        this.busiestCellSize = Math.max(1, ...[...cellOccupants.values()].map(ids => ids.length));
        this._footprintById = footprintById;
    }

    _findComponents(ids, conflicts) {
        const seen = new Set();
        const components = [];
        ids.forEach(start => {
            if (seen.has(start)) return;
            const component = [];
            const stack = [start];
            seen.add(start);
            while (stack.length) {
                const id = stack.pop();
                component.push(id);
                conflicts.get(id).forEach(n => {
                    if (!seen.has(n)) { seen.add(n); stack.push(n); }
                });
            }
            components.push(component);
        });
        return components;
    }

    /** @returns {{rank:number, count:number}} this project's rank within its own conflict cluster */
    slotOf(id) { return this._slot.get(id) ?? { rank: 0, count: 1 }; }

    footprintOf(id) { return this._footprintById.get(id) ?? []; }
}
