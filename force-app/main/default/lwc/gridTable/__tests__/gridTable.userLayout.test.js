/**
 * The user's saved layout: what the table does with config.userLayout
 * (widths, Wrap or Clip, open rows and the sort, applied once per key; a new
 * key with nothing in it puts the admin's layout back), and the layoutchange
 * events it sends so the parent can keep the layout in Salesforce.
 *
 * config.userLayout is not config.layout: that older property chooses between
 * the table and cards ('auto' | 'table' | 'cards').
 *
 * The open rows' panels hold real c/gridChildren and c/gridView components
 * whose configuration never arrives (getGridConfig stays pending), as in
 * gridTable.nesting.test.js.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import { openGridFrom } from '../../gridView/__tests__/openGridFrom';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, width: 200, wrap: true },
    { field: 'Notes__c', label: 'Notes', type: 'text', editable: true, sortable: true, width: 160 },
    { field: 'Amount__c', label: 'Amount', type: 'currency', scale: 2, editable: true, sortable: true, width: 140 },
    { field: 'Stage__c', label: 'Stage', type: 'picklist', editable: true, sortable: false, width: 120 }
];
const id = n => 'a01' + String(n).padStart(15, '0'); // 18 characters, as a record Id
const ROWS = [
    { Id: id(1), Name: 'One', Notes__c: 'First note', Amount__c: 100, Stage__c: 'Open' },
    { Id: id(2), Name: 'Two', Notes__c: 'Second note', Amount__c: 300, Stage__c: 'Won' },
    { Id: id(3), Name: 'Three', Notes__c: 'Third note', Amount__c: 200, Stage__c: 'Open' }
];
const CHILDREN = [{ name: 'Test_Records_Children', label: 'Children', configName: 'Test_Children' }];

let el;
let layouts;
let sorts;
const mount = async (extra = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, ...extra };
    layouts = [];
    sorts = [];
    // The groups' order and percentages are tested in gridTable.groupingMore; here, the rest.
    el.addEventListener('layoutchange', e => {
        const { groupView, ...rest } = e.detail;
        expect(groupView).toEqual({ order: { by: 'name', direction: 'asc' }, percent: false });
        layouts.push(rest);
    });
    el.addEventListener('sortchange', e => sorts.push(e.detail));
    document.body.appendChild(el);
    await flush();
};
/** The parent hands over a new config object (HR-17). */
const handOver = async extra => {
    el.config = { ...el.config, ...extra };
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const th = field => $(`th[data-field="${field}"]`);
const width = field => th(field).style.width;
const dataHeaders = () => $$('thead th[data-field]');
const td = (rowId, field) => $(`td[data-row-id="${rowId}"][data-field="${field}"]`);
const wraps = (rowId, field) => td(rowId, field).classList.contains('slds-cell-wrap');
const order = () => $$('tbody tr[data-row-id]').map(tr => tr.dataset.rowId);
const menuButton = field => $(`[data-menu-button][data-field="${field}"]`);
const items = () => $$('[role="menu"] [role="menuitemradio"], [role="menu"] [role="menuitem"]');
const item = label => items().find(i => i.textContent.trim() === label);
const toggle = rowId => $(`td[data-row-id="${rowId}"][data-field="__expand"] button`);
const detailRows = () => $$('tbody tr[data-kind="detail"]');
const range = field => th(field).querySelector('input[type="range"]');
const key = async (target, k, mods = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...mods });
    target.dispatchEvent(event);
    await flush();
    return event;
};
const resizeByKeyboard = async (field, px) => {
    range(field).dispatchEvent(new CustomEvent('focus'));
    await flush();
    range(field).value = String(px);
    range(field).dispatchEvent(new CustomEvent('input'));
    await flush();
};

let rectSpy;
beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    getGridConfig.mockReturnValue(new Promise(() => {})); // the child grids stay loading
    // JSDOM has no layout: every header cell reports 200.6px, as if the grid
    // had shared its space out. Pinned widths round down to 200.
    rectSpy = jest
        .spyOn(HTMLTableCellElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ width: 200.6, height: 33, top: 0, left: 0, right: 200.6, bottom: 33, x: 0, y: 0 });
});

afterEach(() => {
    rectSpy.mockRestore();
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('applying a saved layout', () => {
    it('pins each saved column at its width, and the table is exactly its columns', async () => {
        await mount({ userLayout: { key: 'k1', widths: { Name: 300, Amount__c: 180 } } });
        expect(width('Name')).toBe('300px');
        expect(width('Amount__c')).toBe('180px');
        // A column with no saved width keeps its own.
        expect(width('Notes__c')).toBe('160px');
        const total = dataHeaders().reduce((sum, cell) => sum + parseInt(cell.style.width, 10), 0);
        expect($('table').style.width).toBe(total + 'px');
    });

    it('keeps a saved width within 20 to 1,000px, and ignores a column the grid no longer has or a width that is not a number', async () => {
        await mount();
        const stage = width('Stage__c');
        await handOver({
            userLayout: { key: 'k1', widths: { Name: 5, Amount__c: 5000, Gone__c: 400, Stage__c: 'wide' } }
        });
        expect(width('Name')).toBe('20px');
        expect(width('Amount__c')).toBe('1000px');
        expect(width('Stage__c')).toBe(stage);
        expect(th('Gone__c')).toBeNull();
    });

    it("applies Wrap or Clip over the admin's default, for wrappable columns the grid has", async () => {
        await mount({
            userLayout: { key: 'k1', wrap: { Name: false, Notes__c: true, Amount__c: true, Gone__c: true } }
        });
        expect(wraps(id(1), 'Name')).toBe(false); // the admin wraps it; the user clipped it
        expect(wraps(id(1), 'Notes__c')).toBe(true);
        expect(wraps(id(1), 'Amount__c')).toBe(false); // a number never wraps
        // The column menu shows the user's choice.
        menuButton('Name').click();
        await flush();
        expect(item('Clip text').getAttribute('aria-checked')).toBe('true');
        expect(item('Wrap text').getAttribute('aria-checked')).toBe('false');
    });

    it('sets the sort it was saved with, on columns that can be sorted, without telling the parent', async () => {
        await mount({
            userLayout: {
                key: 'k1',
                sort: [
                    { field: 'Amount__c', direction: 'desc' },
                    { field: 'Stage__c', direction: 'asc' },
                    { field: 'Gone__c' }
                ]
            }
        });
        expect(order()).toEqual([id(2), id(3), id(1)]); // 300, 200, 100
        expect(th('Amount__c').getAttribute('aria-sort')).toBe('descending');
        expect($$('th[aria-sort="ascending"], th[aria-sort="descending"]')).toHaveLength(1);
        expect(sorts).toEqual([]); // the parent asked for it
    });

    it("wins over the config's first sort", async () => {
        await mount({
            sort: [{ field: 'Name', direction: 'asc' }],
            userLayout: { key: 'k1', sort: [{ field: 'Amount__c', direction: 'asc' }] }
        });
        expect(order()).toEqual([id(1), id(3), id(2)]);
        expect(th('Amount__c').getAttribute('aria-sort')).toBe('ascending');
        expect(th('Name').getAttribute('aria-sort')).toBe('none');
    });

    it('does not send a layoutchange back', async () => {
        await mount({ userLayout: { key: 'k1', widths: { Name: 300 }, wrap: { Notes__c: true } } });
        await frame();
        expect(layouts).toEqual([]);
    });

    it('is applied when it arrives after the rows', async () => {
        await mount();
        expect($('table').style.width).toBe(''); // fills the grid until a width is set
        await handOver({ userLayout: { key: 'k1', widths: { Notes__c: 260 } } });
        expect(width('Notes__c')).toBe('260px');
        expect($('table').style.width).not.toBe('');
    });

    it('is ignored without a key', async () => {
        await mount({ userLayout: { widths: { Name: 300 } } });
        expect(width('Name')).toBe('200px');
        expect($('table').style.width).toBe('');
    });

    it('is applied once per key: what the user changes afterwards stays', async () => {
        await mount({ userLayout: { key: 'k1', widths: { Name: 300 }, wrap: { Notes__c: true } } });
        await resizeByKeyboard('Name', 250);
        menuButton('Notes__c').click();
        await flush();
        item('Clip text').click();
        await flush();
        // New rows and the same layout key, even with other values in it: nothing is put back.
        await handOver({
            rows: ROWS.slice(0, 2),
            userLayout: { key: 'k1', widths: { Name: 999 }, wrap: { Notes__c: true } }
        });
        expect(width('Name')).toBe('250px');
        expect(wraps(id(1), 'Notes__c')).toBe(false);
    });

    it("a new key with nothing in it puts the admin's widths and wrapping back (Reset layout)", async () => {
        await mount();
        const admin = Object.fromEntries(dataHeaders().map(cell => [cell.dataset.field, cell.style.width]));
        await handOver({
            userLayout: { key: 'k1', widths: { Name: 300, Notes__c: 90 }, wrap: { Name: false, Notes__c: true } }
        });
        expect(width('Name')).toBe('300px');
        // What gridView hands over for Reset layout: no widths at all.
        await handOver({ userLayout: { key: 'k2', widths: null, wrap: {}, expanded: [], sort: [] } });
        expect($('table').style.width).toBe(''); // not pinned: the table fills the grid again
        dataHeaders().forEach(cell => expect(cell.style.width).toBe(admin[cell.dataset.field]));
        expect(wraps(id(1), 'Name')).toBe(true); // the admin's default
        expect(wraps(id(1), 'Notes__c')).toBe(false);
        // Widths are no longer the user's: the next layoutchange says so.
        menuButton('Notes__c').click();
        await flush();
        item('Wrap text').click();
        await flush();
        expect(layouts[layouts.length - 1].widths).toBeNull();
    });

    it('is not config.layout: the table or cards choice is unchanged by it', async () => {
        await mount({ layout: 'cards', userLayout: { key: 'k1', widths: { Name: 300 } } });
        expect($('[role="grid"]')).toBeNull();
        expect($$('li.rh-card')).toHaveLength(3);
        await handOver({ layout: 'table' });
        expect($('[role="grid"]')).not.toBeNull();
        expect(width('Name')).toBe('300px');
    });
});

describe('telling the parent what to keep (layoutchange)', () => {
    it('after a resize from the keyboard: every pinned width, the new one included', async () => {
        await mount();
        await resizeByKeyboard('Notes__c', 240);
        expect(layouts).toHaveLength(1);
        expect(layouts[0]).toEqual({
            widths: { Name: 200, Notes__c: 240, Amount__c: 200, Stage__c: 200 },
            wrap: {},
            expanded: []
        });
    });

    it('after a pointer drag: once, when the pointer is let go, at the width it was let go at', async () => {
        await mount();
        const handle = th('Amount__c').querySelector('.slds-resizable__handle');
        handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 500 }));
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }));
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 450 }));
        await flush();
        expect(layouts).toEqual([]); // not while dragging
        window.dispatchEvent(new MouseEvent('pointerup', {}));
        await flush();
        expect(layouts).toHaveLength(1);
        expect(layouts[0].widths.Amount__c).toBe(150);
        expect(width('Amount__c')).toBe('150px');
        // The drag is over: the pointer moving again changes nothing.
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900 }));
        window.dispatchEvent(new MouseEvent('pointerup', {}));
        await flush();
        expect(layouts).toHaveLength(1);
        expect(width('Amount__c')).toBe('150px');
    });

    it('after a double-click that fits a column to its values', async () => {
        await mount();
        th('Notes__c')
            .querySelector('.slds-resizable__handle')
            .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
        await flush();
        expect(layouts).toHaveLength(1);
        expect(width('Notes__c')).toBe(layouts[0].widths.Notes__c + 'px');
    });

    it('after Wrap text or Clip text from a column menu, chosen from the keyboard', async () => {
        await mount();
        await key(menuButton('Notes__c'), 'ArrowDown');
        await key(items()[0], 'ArrowDown');
        await key(items()[1], 'ArrowDown');
        expect(el.shadowRoot.activeElement).toBe(item('Wrap text'));
        await key(item('Wrap text'), 'Enter');
        // Widths are null: the user has not set one.
        expect(layouts).toEqual([{ widths: null, wrap: { Notes__c: true }, expanded: [] }]);
        await key(menuButton('Name'), 'ArrowUp'); // the last item: Clip text
        await key(item('Clip text'), ' ');
        expect(layouts[1]).toEqual({ widths: null, wrap: { Notes__c: true, Name: false }, expanded: [] });
    });

    it('does not count widths pinned without the user setting one', async () => {
        await mount();
        range('Name').dispatchEvent(new CustomEvent('focus')); // pins every column, sets none
        await flush();
        expect($('table').style.width).not.toBe('');
        menuButton('Notes__c').click();
        await flush();
        item('Wrap text').click();
        await flush();
        expect(layouts).toEqual([{ widths: null, wrap: { Notes__c: true }, expanded: [] }]);
    });

    it('does not count widths pinned to freeze columns', async () => {
        await mount({ frozenColumns: 1 });
        await frame();
        await flush();
        menuButton('Notes__c').click();
        await flush();
        item('Wrap text').click();
        await flush();
        expect(layouts[0].widths).toBeNull();
    });

    it("reports a saved layout's widths with the next change: they are still the user's", async () => {
        await mount({ userLayout: { key: 'k1', widths: { Name: 300 } } });
        menuButton('Notes__c').click();
        await flush();
        item('Wrap text').click();
        await flush();
        expect(layouts).toEqual([{ widths: { Name: 300 }, wrap: { Notes__c: true }, expanded: [] }]);
    });
});

describe('open rows', () => {
    it('opens the rows a saved layout names, and only real record Ids', async () => {
        await mount({ children: CHILDREN, userLayout: { key: 'k1', expanded: [id(2), 'not-an-id', 42, id(3)] } });
        expect(order()).toEqual([id(1), id(2), 'rh-detail:' + id(2), id(3), 'rh-detail:' + id(3)]);
        expect(toggle(id(2)).getAttribute('aria-expanded')).toBe('true');
        expect(toggle(id(1)).getAttribute('aria-expanded')).toBe('false');
    });

    it('opens at most 50 rows', async () => {
        const rows = Array.from({ length: 55 }, (_, i) => ({ Id: id(i + 1), Name: 'Row ' + (i + 1), Amount__c: i }));
        await mount({ rows, children: CHILDREN, userLayout: { key: 'k1', expanded: rows.map(r => r.Id) } });
        expect(detailRows()).toHaveLength(50);
        expect(toggle(id(50)).getAttribute('aria-expanded')).toBe('true');
        expect(toggle(id(51)).getAttribute('aria-expanded')).toBe('false');
    });

    it('tells the parent when a row is opened or closed with its toggle', async () => {
        await mount({ children: CHILDREN });
        toggle(id(1)).click();
        await flush();
        expect(layouts).toEqual([{ widths: null, wrap: {}, expanded: [id(1)] }]);
        toggle(id(3)).click();
        await flush();
        expect(layouts[1].expanded).toEqual([id(1), id(3)]);
        toggle(id(1)).click();
        await flush();
        expect(layouts[2].expanded).toEqual([id(3)]);
    });

    it('tells the parent when Enter on the toggle cell opens a row', async () => {
        await mount({ children: CHILDREN });
        const cell = td(id(2), '__expand');
        cell.focus();
        await flush();
        await key(cell, 'Enter');
        expect(detailRows()).toHaveLength(1);
        expect(layouts).toEqual([{ widths: null, wrap: {}, expanded: [id(2)] }]);
        await key(td(id(2), '__expand'), ' ');
        expect(detailRows()).toHaveLength(0);
        expect(layouts[1].expanded).toEqual([]);
    });

    it('tells the parent nothing when a row with no related records is not opened', async () => {
        await mount({ children: CHILDREN, childCounts: { [id(1)]: { total: 0, byTab: {} } } });
        const cell = td(id(1), '__expand');
        cell.focus();
        await flush();
        await key(cell, 'Enter');
        expect(detailRows()).toHaveLength(0);
        expect(layouts).toEqual([]);
    });

    it("tells the parent when a card's related records are shown or hidden", async () => {
        await mount({ children: CHILDREN, layout: 'cards' });
        $(`.rh-card-expand[data-row-id="${id(2)}"]`).click();
        await flush();
        expect(layouts).toEqual([{ widths: null, wrap: {}, expanded: [id(2)] }]);
    });

    it('a new key with no open rows closes the ones the old layout opened', async () => {
        await mount({ children: CHILDREN, userLayout: { key: 'k1', expanded: [id(1)] } });
        expect(detailRows()).toHaveLength(1);
        await handOver({ userLayout: { key: 'k2', widths: {}, wrap: {}, expanded: [] } });
        expect(detailRows()).toHaveLength(0);
    });
});
