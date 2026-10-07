/**
 * HR-10, HR-11, HR-14 — ARIA structure.
 *
 * WHY THIS TEST EXISTS
 * The APG's warning about inconsistent row indices is unusually strong: it
 * "could cause screen reader table reading functions to skip rows or simply
 * stop functioning." That failure is invisible to a sighted developer, so it
 * has to be caught mechanically.
 *
 * Note what this test canNOT do: @sa11y/jest disables aria-required-children
 * and aria-required-parent because they do not work in JSDOM. Those are exactly
 * the rules a grid needs, so the real-browser pass is not optional.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from './fixtures/seed';

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ARIA grid structure', () => {
    let el, root;
    beforeEach(async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows };
        document.body.appendChild(el);
        await flushPromises();
        root = el.shadowRoot.querySelector('[role="grid"]');
    });
    afterEach(() => { while (document.body.firstChild) document.body.firstChild.remove(); });

    it('declares role="grid"', () => {
        expect(root).not.toBeNull();
    });

    it('puts aria-rowindex on every row including the header, or on none (HR-10)', () => {
        const rows = [...root.querySelectorAll('[role="row"]')];
        const indexed = rows.filter(r => r.hasAttribute('aria-rowindex'));
        // All or nothing. Partial is the documented failure mode.
        expect([0, rows.length]).toContain(indexed.length);

        if (indexed.length) {
            const values = indexed.map(r => Number(r.getAttribute('aria-rowindex')));
            expect(Math.min(...values)).toBe(1);                       // 1-based
            expect(values).toEqual([...values].sort((a, b) => a - b)); // increasing
            expect(new Set(values).size).toBe(values.length);          // no duplicates
        }
    });

    it('sets aria-rowcount to the real total or to -1 while it is unknown (HR-10)', () => {
        const count = root.getAttribute('aria-rowcount');
        expect(count).not.toBeNull();
        const n = Number(count);
        // -1 is explicitly sanctioned by the ARIA specification for an unknown total. Anything
        // else must equal data rows plus the header row.
        expect(n === -1 || n === seedRows.length + 1).toBe(true);
    });

    it('makes every cell focusable or gives it exactly one focusable child (HR-11)', () => {
        const cells = [...root.querySelectorAll('[role="gridcell"]')];
        expect(cells.length).toBeGreaterThan(0);
        cells.forEach(cell => {
            const selfFocusable = cell.hasAttribute('tabindex');
            const focusableChildren = cell.querySelectorAll('[tabindex]');
            // The APG names two optimal designs and warns against anything else:
            // focus the cell, or focus a single widget inside it.
            expect(selfFocusable || focusableChildren.length === 1).toBe(true);
        });
    });

    it('uses aria-sort="none" for a sortable unsorted column, never "other" (HR-14)', () => {
        const sortable = [...root.querySelectorAll('[role="columnheader"][data-sortable="true"]')];
        expect(sortable.length).toBeGreaterThan(0);
        const values = sortable.map(h => h.getAttribute('aria-sort'));
        expect(values).not.toContain('other');   // what lightning-datatable emits
        values.forEach(v => expect(['none', 'ascending', 'descending']).toContain(v));
    });

    it('marks a sort direction on at most one column (HR-14)', async () => {
        el.shadowRoot.querySelector('[data-field="Text_Field__c"] .slds-th__action').click();
        await flushPromises();
        const directed = [...root.querySelectorAll('[role="columnheader"]')]
            .filter(h => ['ascending', 'descending'].includes(h.getAttribute('aria-sort')));
        // ARIA cannot express multiple sort keys, so multi-column sort is not
        // fully representable. One column carries the announcement.
        expect(directed.length).toBeLessThanOrEqual(1);
    });
});
