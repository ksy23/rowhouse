/**
 * HR-17, HR-18, HR-19 — reactivity and row keys.
 *
 * WHY THIS TEST EXISTS
 * HR-17 guards an open LWC defect with no fix coming. If a child clones an
 * incoming array in its @api setter, and the parent then mutates that array in
 * place, the reference never changes, the setter never fires, and the child
 * silently shows stale data. A core maintainer diagnosed it and concluded it
 * "is maybe not a bug in LWC, but it is certainly counter-intuitive behavior."
 *
 * The own-table build multiplies the number of @api array boundaries we own, so
 * every one of them needs this test.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from './fixtures/seed';

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('reactivity across the @api boundary', () => {
    let el;
    let raf;
    let caf;
    const rendered = () => el.shadowRoot.querySelectorAll('[role="row"][data-row-id]').length;

    // Animation frames are run by hand. On a busy machine jsdom's own frame
    // could land inside a test, after the rows array was changed in place,
    // and redraw from it.
    const queued = new Map();
    let next = 0;
    const runFrames = async (left = 20) => {
        if (!left || !queued.size) return;
        const due = [...queued.values()];
        queued.clear();
        due.forEach(cb => cb(performance.now()));
        await flushPromises();
        await runFrames(left - 1);
    };

    beforeEach(async () => {
        raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
            next += 1;
            queued.set(next, cb);
            return next;
        });
        caf = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => queued.delete(handle));
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: [...seedRows] };
        document.body.appendChild(el);
        await flushPromises();
        await runFrames();
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        queued.clear();
        raf.mockRestore();
        caf.mockRestore();
    });

    it('re-renders when the parent replaces the rows array (HR-17)', async () => {
        const before = rendered();
        el.config = { columns, rows: seedRows.slice(0, 5) }; // new reference
        await flushPromises();
        expect(rendered()).toBe(5);
        expect(rendered()).not.toBe(before);
    });

    it('does not depend on in-place mutation being observed (HR-17)', async () => {
        // Documents the contract rather than asserting the defect away: callers
        // must hand us a new reference. If someone "fixes" this test by making
        // the component clone and deep-track, HR-17 has been broken and the
        // lint rule should have caught it first.
        const rows = [...seedRows];
        el.config = { columns, rows };
        await flushPromises();
        await runFrames();
        const before = rendered();

        rows.push({ ...seedRows[0], Id: 'a00_mutated_in_place' }); // no new reference
        await flushPromises();

        expect(rendered()).toBe(before); // deliberately unchanged
    });

    it('gives every row a stable key derived from Id, not content or index (HR-19)', async () => {
        // TC-047 and TC-048 are byte-identical in every displayed field.
        const twins = seedRows.filter(r => /TC-04[78]/.test(r.Test_Case__c));
        expect(twins).toHaveLength(2);

        // Rows only. Cells and in-cell controls also carry data-row-id — the
        // focus tests select a cell by [data-row-id][data-field] — so counting
        // every [data-row-id] would count each record once per cell.
        const keys = [...el.shadowRoot.querySelectorAll('[role="row"][data-row-id]')].map(n => n.dataset.rowId);
        expect(new Set(keys).size).toBe(keys.length); // all distinct
        twins.forEach(t => expect(keys).toContain(t.Id));
    });

    it('keeps row keys stable across a sort (HR-19)', async () => {
        const before = [...el.shadowRoot.querySelectorAll('[role="row"][data-row-id]')].map(n => n.dataset.rowId);
        el.shadowRoot.querySelector('[data-field="Number_Field__c"] .slds-th__action').click();
        await flushPromises();
        const after = [...el.shadowRoot.querySelectorAll('[role="row"][data-row-id]')].map(n => n.dataset.rowId);

        expect(after.sort()).toEqual(before.sort()); // same set, reordered
    });
});
