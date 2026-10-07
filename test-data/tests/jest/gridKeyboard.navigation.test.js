/**
 * Keyboard model — the documented edges.
 *
 * WHY THIS TEST EXISTS
 * The W3C APG is explicit that arrow keys in a DATA grid must not wrap, because
 * wrapping "would be disorienting… especially for users of assistive
 * technologies." Salesforce documents the same four edges as a table. Both are
 * written specifications, so this is conformance testing rather than invention.
 *
 * Each assertion below maps to one row of Salesforce's documented edge table.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from './fixtures/seed';

/**
 * Flush LWC's render queue.
 *
 * A single microtask tick is enough for one rerender, but not where a handler
 * awaits or where one render triggers another — which is exactly the shape of
 * sort-then-restore-focus and enter-action-mode-then-focus-the-input. A
 * macrotask covers both. Note @sa11y/jest is incompatible with fake timers, so
 * do not reach for jest.runAllTimers() here.
 */
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Read the focused element, failing with a readable message rather than a
 * TypeError. JSDOM's focus() is a no-op on an element with no tabindex, and
 * HR-11 explicitly allows a cell that is not itself focusable — so activeElement
 * can legitimately be null and the assertion has to say so.
 */
const activeIn = (el) => {
    const a = el.shadowRoot.activeElement;
    if (!a) {
        throw new Error(
            'Nothing is focused. In JSDOM, focus() is a no-op on an element with no '
            + 'tabindex — check that the cell or its child carries one (HR-11).'
        );
    }
    return a;
};


const key = (el, k, opts = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...opts }));

describe('keyboard navigation edges', () => {
    let el;
    beforeEach(async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows };
        document.body.appendChild(el);
        await flushPromises();
    });
    afterEach(() => { while (document.body.firstChild) document.body.firstChild.remove(); });

    const at = () => {
        const a = activeIn(el);
        return { row: a.dataset.rowIndex, col: a.dataset.colIndex };
    };
    const focusAt = async (rowIndex, colIndex) => {
        el.shadowRoot
          .querySelector(`[data-row-index="${rowIndex}"][data-col-index="${colIndex}"]`)
          .focus();
        await flushPromises();
    };

    it('ArrowUp on the header row does not move', async () => {
        await focusAt('0', '1');
        key(activeIn(el), 'ArrowUp');
        await flushPromises();
        expect(at()).toEqual({ row: '0', col: '1' });
    });

    it('ArrowRight on the last cell of a row does not wrap to the next row', async () => {
        const last = String(columns.length);
        await focusAt('1', last);
        key(activeIn(el), 'ArrowRight');
        await flushPromises();
        expect(at()).toEqual({ row: '1', col: last });
    });

    it('ArrowDown on the bottom row does not move', async () => {
        const bottom = String(seedRows.length);
        await focusAt(bottom, '1');
        key(activeIn(el), 'ArrowDown');
        await flushPromises();
        expect(at()).toEqual({ row: bottom, col: '1' });
    });

    it('ArrowLeft on the first data column does not move', async () => {
        await focusAt('1', '1');
        key(activeIn(el), 'ArrowLeft');
        await flushPromises();
        expect(at()).toEqual({ row: '1', col: '1' });
    });

    it('Enter switches to action mode and Escape returns to navigation mode', async () => {
        await focusAt('1', '1');
        key(activeIn(el), 'Enter');
        await flushPromises();
        // In action mode the in-cell control is reachable by Tab, so it must be
        // tabbable rather than tabindex="-1".
        const input = el.shadowRoot.activeElement;
        expect(input.getAttribute('tabindex')).toBe('0');

        key(input, 'Escape');
        await flushPromises();
        // Back on the same cell, not moved and not still in the input.
        expect(at()).toEqual({ row: '1', col: '1' });
    });

    it('Ctrl+End moves to the last cell of the last row in the DATA, not the DOM', async () => {
        // The APG flags this specifically for virtualized grids: if only part of
        // the data is rendered, Ctrl+End must not land on the last rendered row.
        await focusAt('1', '1');
        key(activeIn(el), 'End', { ctrlKey: true });
        await flushPromises();
        expect(at().row).toBe(String(seedRows.length));
    });
});
