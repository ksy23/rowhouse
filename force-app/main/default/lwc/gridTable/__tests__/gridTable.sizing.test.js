/**
 * Widths and row height: a figure is never cut
 * off, numbers and dates widen to their widest loaded value, the table
 * scrolls sideways rather than squeeze them, a double-click on a resize
 * handle fits the column, and wrapped rows are as tall as their data needs,
 * one to three lines, all rows alike (revisits). The arithmetic is
 * tested in c/gridSizing; this is what the table does with it.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { MIN_WIDTH_BY_TYPE, FIT_CAP, TEXT_FIT_CAP, fitWidth } from 'c/gridSizing';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', scale: 2, editable: true, sortable: true },
    { field: 'Ship_Date__c', label: 'Ship Date', type: 'date', editable: true, sortable: true, width: 60 },
    {
        field: 'Handling_Instructions__c',
        label: 'Handling Instructions',
        type: 'text',
        editable: true,
        sortable: true,
        wrap: true,
        width: 200
    }
];
const row = (n, extra = {}) => ({
    Id: `a01000000000000${n}AA`.slice(0, 18),
    Name: 'Kennebec Lumber, load ' + n,
    Freight_Charge__c: 10,
    Ship_Date__c: '2026-09-29',
    Handling_Instructions__c: 'Liftgate',
    ...extra
});

let el;
const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: [row(1), row(2)], ...config };
    document.body.appendChild(el);
    await flush();
};
const th = field => el.shadowRoot.querySelector(`th[data-field="${field}"]`);
const px = field => parseInt(th(field).style.width, 10);
const table = () => el.shadowRoot.querySelector('table');

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('column widths', () => {
    it('never draws a date or a figure narrower than its type needs, whatever the admin set', async () => {
        await mount();
        expect(px('Ship_Date__c')).toBeGreaterThanOrEqual(MIN_WIDTH_BY_TYPE.date); // the admin said 60
        expect(px('Freight_Charge__c')).toBeGreaterThanOrEqual(MIN_WIDTH_BY_TYPE.currency);
    });

    it('widens a figure column to its widest loaded value, up to a cap', async () => {
        await mount();
        const narrow = px('Freight_Charge__c');
        el.config = { columns: COLUMNS, rows: [row(1), row(2, { Freight_Charge__c: 1234567890.12 })] };
        await flush();
        const wide = px('Freight_Charge__c');
        expect(wide).toBeGreaterThan(narrow);
        expect(wide).toBeLessThanOrEqual(FIT_CAP);
    });

    it('counts an unsaved edit when fitting', async () => {
        await mount();
        const before = px('Freight_Charge__c');
        el.config = {
            columns: COLUMNS,
            rows: [row(1), row(2)],
            drafts: { [row(2).Id]: { Freight_Charge__c: 987654321.99 } }
        };
        await flush();
        expect(px('Freight_Charge__c')).toBeGreaterThan(before);
    });

    it('is never narrower than its columns: it scrolls sideways instead', async () => {
        await mount();
        const total = [...el.shadowRoot.querySelectorAll('thead th[data-field]')].reduce(
            (sum, h) => sum + parseInt(h.style.width, 10),
            0
        );
        expect(table().style.minWidth).toBe(`${total}px`);
        expect(table().style.width).toBe(''); // not pinned: it still fills the grid
    });

    it('fits a column to its values on a double-click of its resize handle', async () => {
        const long = 'Call Hannah Pelletier before delivery; the rear dock closes at 3 PM';
        await mount({ rows: [row(1), row(2, { Handling_Instructions__c: long })] });
        const handle = th('Handling_Instructions__c').querySelector('.slds-resizable__handle');
        handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
        await flush();
        const want = fitWidth([long, 'Liftgate'], {
            type: 'text',
            editable: true,
            label: 'Handling Instructions',
            cap: TEXT_FIT_CAP
        });
        expect(px('Handling_Instructions__c')).toBe(want);
        expect(table().style.width).not.toBe(''); // widths are pinned, as after a drag
        // The double-click is the handle's: no cell editor opened.
        expect(el.shadowRoot.querySelector('[data-editor]')).toBeNull();
    });
});

describe('wrapped rows sized to their data (revisits)', () => {
    const lines = () => table().style.getPropertyValue('--rh-wrap-lines');

    it('is one line when every wrapped value fits on one', async () => {
        await mount();
        expect(lines()).toBe('1');
    });

    it('is as many lines as the longest value needs, up to three', async () => {
        await mount({ rows: [row(1), row(2, { Handling_Instructions__c: 'Rear dock\nRing bell twice' })] });
        expect(lines()).toBe('2');
        el.config = {
            columns: COLUMNS,
            rows: [row(1), row(2, { Handling_Instructions__c: 'Liftgate required. '.repeat(60) })]
        };
        await flush();
        expect(lines()).toBe('3');
    });

    it("follows the user's choice to clip the column", async () => {
        await mount({ rows: [row(1), row(2, { Handling_Instructions__c: 'Rear dock\nRing bell twice' })] });
        expect(el.shadowRoot.querySelector('td[data-field="Handling_Instructions__c"] .rh-wrap-text')).not.toBeNull();
        const clipped = COLUMNS.map(c => (c.field === 'Handling_Instructions__c' ? { ...c, wrap: false } : c));
        el.config = {
            columns: clipped,
            rows: [row(1), row(2, { Handling_Instructions__c: 'Rear dock\nRing bell twice' })]
        };
        await flush();
        expect(el.shadowRoot.querySelector('td[data-field="Handling_Instructions__c"] .rh-wrap-text')).toBeNull();
    });
});
