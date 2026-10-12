/**
 * The list of rendered columns (layoutColumns) is built once for each change
 * to what it is made of, not every time it is read. Until a cell has focus,
 * every cell asks for it while the table is drawn, and each build copied every
 * column through LWC's read-only proxies: with 20 columns, loading 10,000 rows
 * was about four times slower than with 5, and a sort's redraw about as much.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// Every list layoutColumns hands out, in order.
let lists = [];
const descriptor = Object.getOwnPropertyDescriptor(GridTable.prototype, 'layoutColumns');
Object.defineProperty(GridTable.prototype, 'layoutColumns', {
    configurable: true,
    get() {
        const list = descriptor.get.call(this);
        lists.push(list);
        return list;
    }
});
const built = () => new Set(lists).size;

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    { field: 'Service_Level__c', label: 'Service Level', type: 'text', editable: true, sortable: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', editable: true, sortable: true }
];
const id = n => `a01${String(n).padStart(15, '0')}`;
const ROWS = Array.from({ length: 12 }, (_, i) => ({
    Id: id(i + 1),
    Name: 'Kennebec Lumber, load ' + (i + 1),
    Service_Level__c: 'Standard',
    Freight_Charge__c: i * 10
}));

describe('the column list is built once per change', () => {
    let el;
    const mount = async (extra = {}) => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns: COLUMNS, rows: ROWS, ...extra };
        document.body.appendChild(el);
        await flush();
        lists = [];
    };
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('hands out the same list on every read of a redraw', async () => {
        await mount();
        el.config = { ...el.config, rows: ROWS.slice(0, 10) }; // a redraw, the columns unchanged
        await flush();
        expect(lists.length).toBeGreaterThan(1); // the header, the rows and the widths all read it
        expect(built()).toBe(1);
    });

    it('works out the default focus cell once per redraw, not once per cell', async () => {
        // Nothing has focus, so every cell's check needs the default cell, and
        // working it out reads the column list. 12 rows of 3 cells and 3 header
        // cells make 78 checks; read once per check, the list was read at least
        // that often in one redraw.
        await mount();
        el.config = { ...el.config, rows: ROWS.slice(0, 12).reverse() };
        await flush();
        expect(lists.length).toBeLessThan(20);
        const stops = el.shadowRoot.querySelectorAll('[role="grid"] [tabindex="0"]');
        expect(stops).toHaveLength(1);
        expect(stops[0].dataset.rowId).toBe(id(12)); // the first row now
        expect(stops[0].dataset.field).toBe('Name');
    });

    it('keeps that list through later redraws while the columns stay the same', async () => {
        await mount();
        el.config = { ...el.config, rows: ROWS.slice(0, 10) };
        await flush();
        const first = lists[0];
        el.config = { ...el.config, rows: ROWS.slice(0, 8), drafts: { [id(1)]: { Service_Level__c: 'Express' } } };
        await flush();
        expect(built()).toBe(1);
        expect(lists[lists.length - 1]).toBe(first);
    });

    it('builds a new list for new columns, and the table draws them', async () => {
        await mount();
        el.config = { ...el.config, columns: COLUMNS.slice(0, 2) };
        await flush();
        expect(built()).toBe(1);
        expect(lists[0].map(c => c.field)).toEqual(['Name', 'Service_Level__c']);
        expect([...el.shadowRoot.querySelectorAll('thead th[data-field]')].map(th => th.dataset.field)).toEqual([
            'Name',
            'Service_Level__c'
        ]);
    });

    it('builds a new list when a row status column comes, and when it goes', async () => {
        await mount();
        el.config = { ...el.config, errors: { [id(2)]: { row: 'Could not be saved', fields: {} } } };
        await flush();
        expect(lists[lists.length - 1].map(c => c.field)).toEqual([
            '__status',
            'Name',
            'Service_Level__c',
            'Freight_Charge__c'
        ]);
        el.config = { ...el.config, errors: {} };
        await flush();
        expect(lists[lists.length - 1].map(c => c.field)).toEqual(['Name', 'Service_Level__c', 'Freight_Charge__c']);
    });

    it('builds a new list with the selection column', async () => {
        await mount();
        el.config = { ...el.config, selection: 'multi' };
        await flush();
        const last = lists[lists.length - 1];
        expect(last.map(c => c.field)).toEqual(['__select', 'Name', 'Service_Level__c', 'Freight_Charge__c']);
        expect(last.map(c => c.colIndex)).toEqual([1, 2, 3, 4]);
    });

    it('builds a new list when a column is wrapped from its menu', async () => {
        await mount();
        const before = lists.length ? lists[lists.length - 1] : null;
        el.shadowRoot.querySelector('th[data-field="Service_Level__c"] [data-menu-button]').click();
        await flush();
        el.shadowRoot.querySelector('[role="menuitemradio"][data-field="Service_Level__c"][data-wrap="true"]').click();
        await flush();
        const last = lists[lists.length - 1];
        expect(last).not.toBe(before);
        expect(last.find(c => c.field === 'Service_Level__c').wrapped).toBe(true);
    });
});
