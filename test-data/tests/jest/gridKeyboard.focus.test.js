/**
 * HR-13 — focus survives a re-render.
 *
 * WHY THIS TEST EXISTS
 * Reordering a keyed for:each in LWC can unmount and remount a row component,
 * which destroys whatever had focus inside it. This was filed by LWC's own
 * maintainer, who noted that fixing it "would be an observable change, so could
 * break consumers" — so it is not going to be fixed, and we design around it.
 *
 * The distinction this test enforces is the whole point: after a sort, focus
 * must follow THE RECORD, not the screen position. If focus stays on row 3
 * while row 3 is now a different record, the user is about to edit the wrong
 * row and will not notice.
 *
 * This is the single most important Jest test in the suite.
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
const activeIn = el => {
    const a = el.shadowRoot.activeElement;
    if (!a) {
        throw new Error(
            'Nothing is focused. In JSDOM, focus() is a no-op on an element with no ' +
                'tabindex — check that the cell or its child carries one (HR-11).'
        );
    }
    return a;
};

describe('focus restoration (HR-13)', () => {
    let el;
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    const focusCell = (recordId, field) => {
        const cell = el.shadowRoot.querySelector(`[data-row-id="${recordId}"][data-field="${field}"]`);
        cell.focus();
        return cell;
    };

    beforeEach(async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows };
        document.body.appendChild(el);
        await flushPromises();
    });

    it('keeps focus on the same record after a column sort reorders rows', async () => {
        // TC-047 and TC-048 are two records with identical field values. Pick a
        // record that demonstrably moves when sorted.
        const target = seedRows.find(r => r.Test_Case__c.startsWith('TC-054'));
        focusCell(target.Id, 'Text_Field__c');

        el.shadowRoot.querySelector('[data-field="Text_Field__c"] .slds-th__action').click();
        await flushPromises();

        const active = activeIn(el);
        expect(active.dataset.rowId).toBe(target.Id); // the record, not the position
        expect(active.dataset.field).toBe('Text_Field__c');
    });

    it('keeps exactly one cell carrying slds-has-focus (HR-12)', async () => {
        focusCell(seedRows[0].Id, 'Text_Field__c');
        await flushPromises();
        focusCell(seedRows[3].Id, 'Number_Field__c');
        await flushPromises();

        // SLDS sets outline:0 on focused cells and relies on this class for the
        // visible ring. Two of them, or none, and the focus indicator is wrong.
        const marked = el.shadowRoot.querySelectorAll('.slds-has-focus');
        expect(marked).toHaveLength(1);
        expect(marked[0].dataset.rowId).toBe(seedRows[3].Id);
    });

    it('restores focus to the last focused cell when the grid is re-entered', async () => {
        focusCell(seedRows[2].Id, 'Currency_Field__c');
        el.shadowRoot.querySelector('[data-grid-root]').blur();
        await flushPromises();
        el.focus();
        await flushPromises();

        expect(activeIn(el).dataset.rowId).toBe(seedRows[2].Id);
    });
});
