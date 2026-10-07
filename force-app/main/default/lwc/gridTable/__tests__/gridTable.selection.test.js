/**
 * Selection: select-all, the selection cap, and single-select mode.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('selection', () => {
    let el;
    const mount = async extra => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows.slice(0, 10), ...extra };
        document.body.appendChild(el);
        await flush();
    };
    afterEach(() => { while (document.body.firstChild) document.body.firstChild.remove(); });

    it('renders no selection column unless asked', async () => {
        await mount({});
        expect(el.shadowRoot.querySelector('[data-field="__select"]')).toBeNull();
    });

    it('lines each row\'s checkbox up under Select all: both right-aligned, as in the SLDS blueprint', async () => {
        await mount({ selection: 'multi' });
        expect(el.shadowRoot.querySelector('th[data-field="__select"]').classList).toContain('slds-text-align_right');
        const cells = [...el.shadowRoot.querySelectorAll('td[data-field="__select"]')];
        expect(cells).toHaveLength(10);
        cells.forEach(td => expect(td.classList).toContain('slds-text-align_right'));
    });

    it('gives the Select all box a wrapper of its own class, which fills the cell (gridTable.css)', async () => {
        // Found in Lightning Experience: SLDS's 32px wrapper turned
        // white on focus and covered the cell's focus ring.
        await mount({ selection: 'multi' });
        const input = el.shadowRoot.querySelector('th[data-field="__select"] input');
        expect(input.closest('.rh-select-all-action')).not.toBeNull();
    });

    it('select-all selects every row and marks them aria-selected', async () => {
        await mount({ selection: 'multi' });
        const handler = jest.fn();
        el.addEventListener('selectionchange', handler);
        const all = el.shadowRoot.querySelector('th[data-field="__select"] input');
        all.checked = true;
        all.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(handler.mock.calls[0][0].detail.selectedIds).toHaveLength(10);
        const rows = [...el.shadowRoot.querySelectorAll('tr[role="row"][data-row-id]')];
        rows.forEach(r => expect(r.getAttribute('aria-selected')).toBe('true'));
        expect(el.shadowRoot.querySelector('table').getAttribute('aria-multiselectable')).toBe('true');
    });

    it('disables unselected rows once the cap is reached', async () => {
        await mount({ selection: 'multi', maxSelected: 2 });
        const boxes = () => [...el.shadowRoot.querySelectorAll('td[data-field="__select"] input')];
        boxes()[0].click();
        await flush();
        boxes()[1].click();
        await flush();
        const disabled = boxes().filter(b => b.disabled);
        expect(disabled).toHaveLength(8);
        expect(boxes()[0].disabled).toBe(false); // selected rows can still be cleared
    });

    it('single-select renders radios and no header control', async () => {
        await mount({ selection: 'single' });
        expect(el.shadowRoot.querySelector('th[data-field="__select"] input')).toBeNull();
        const inputs = [...el.shadowRoot.querySelectorAll('td[data-field="__select"] input')];
        inputs.forEach(i => expect(i.type).toBe('radio'));
        inputs[0].click();
        await flush();
        inputs[3].click();
        await flush();
        const selected = [...el.shadowRoot.querySelectorAll('tr[aria-selected="true"]')];
        expect(selected).toHaveLength(1);
        expect(selected[0].dataset.rowId).toBe(seedRows[3].Id);
    });

    it('Space on a focused data cell toggles its row', async () => {
        await mount({ selection: 'multi' });
        const td = el.shadowRoot.querySelector(`td[data-row-id="${seedRows[2].Id}"][data-field="Name"]`);
        td.focus();
        await flush();
        td.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true, cancelable: true }));
        await flush();
        const row = el.shadowRoot.querySelector(`tr[data-row-id="${seedRows[2].Id}"]`);
        expect(row.getAttribute('aria-selected')).toBe('true');
    });

    it('clears the selection when the parent hands a new selectionKey, and keeps it otherwise', async () => {
        await mount({ selection: 'multi', selectionKey: 1 });
        const boxes = () => [...el.shadowRoot.querySelectorAll('td[data-field="__select"] input')];
        boxes()[0].click();
        boxes()[1].click();
        await flush();
        const selected = () => el.shadowRoot.querySelectorAll('tr[aria-selected="true"]').length;
        expect(selected()).toBe(2);
        // A new config object with the same key: an edit, say. The selection stays.
        el.config = { columns, rows: seedRows.slice(0, 10), selection: 'multi', selectionKey: 1 };
        await flush();
        expect(selected()).toBe(2);
        // A new key: the rows were reloaded or deleted.
        el.config = { columns, rows: seedRows.slice(1, 10), selection: 'multi', selectionKey: 2 };
        await flush();
        expect(selected()).toBe(0);
        expect(boxes().every(b => !b.checked)).toBe(true);
    });
});
