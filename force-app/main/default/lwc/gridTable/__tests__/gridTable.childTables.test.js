/**
 * Child tables under rows: the toggle column, the panel row that holds
 * an open row's tabs of related records, the keys into and out of it, the
 * windowing with taller rows, the card layout, and the parent table leaving
 * the child grids' own keys, clicks and clipboard alone.
 *
 * The panels hold real c/gridChildTabs and c/gridView components. Their
 * configuration never arrives (getGridConfig stays pending), so only what the
 * parent table hands them is under test here; gridView.test.js and
 * gridChildTabs.test.js cover the rest.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { rowTop, rowAt, panelHeightFor, DETAIL_HEIGHT, NESTED_DETAIL_HEIGHT } from 'c/gridChildTables';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import { openGridFrom } from '../../gridView/__tests__/openGridFrom';

/* global require, __dirname -- Jest runs in Node, where one test reads the stylesheet. */
const fs = require('fs');
const path = require('path');

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        editable: true,
        sortable: true,
        groupable: true
    },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', scale: 2, editable: true, sortable: true }
];
const id = n => `a01000000000000${n}AA`.slice(0, 18);
const ROWS = [
    { Id: id(1), Name: 'Kennebec Lumber, 12 bundles', Service_Level__c: 'Standard', Freight_Charge__c: 100 },
    { Id: id(2), Name: 'Saco River Outfitters, 3 crates', Service_Level__c: 'Express', Freight_Charge__c: 200 },
    { Id: id(3), Name: 'Penobscot Paper, full truck', Service_Level__c: 'Standard', Freight_Charge__c: 50 }
];
const CHILDREN = [
    { name: 'Consignments_Items', label: 'Items', configName: 'Consignment_Items' },
    { name: 'Consignments_Inspections', label: 'Inspections', configName: 'Inspections' }
];

let el;
let events;
const mount = async (config = {}) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, totalRows: ROWS.length, children: CHILDREN, level: 1, ...config };
    events = { cellschange: [], selectionchange: [] };
    Object.keys(events).forEach(name => el.addEventListener(name, e => events[name].push(e.detail)));
    document.body.appendChild(el);
    await flush();
};
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const cell = (rowId, field) => $(`td[data-row-id="${rowId}"][data-field="${field}"]`);
const toggle = rowId => $(`td[data-row-id="${rowId}"][data-field="__expand"] button`);
const detailId = rowId => 'rh-detail:' + rowId;
const detailCell = rowId => cell(detailId(rowId), '__detail');
const rowOrder = () => $$('tbody tr[role="row"]').map(tr => tr.dataset.rowId);
const announcement = () => $('[data-grid-root] > [aria-live="polite"]').textContent;
const key = async (target, k, mods = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...mods });
    target.dispatchEvent(event);
    await flush();
    return event;
};
const focusOn = async target => {
    target.focus();
    await flush();
    return target;
};
const open = async rowId => {
    toggle(rowId).click();
    await flush();
};

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    getGridConfig.mockReturnValue(new Promise(() => {})); // the child grids stay loading
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('the toggle column', () => {
    it('is not there without child tables', async () => {
        await mount({ children: [] });
        expect($('th[data-field="__expand"]')).toBeNull();
        expect($$('td[data-field="__expand"]')).toHaveLength(0);
        expect($('table').getAttribute('aria-colcount')).toBe('3');
    });

    it('comes before the data, named for screen readers, with a closed toggle on each record', async () => {
        await mount();
        const th = $('th[data-field="__expand"]');
        expect(th.getAttribute('aria-colindex')).toBe('1');
        expect(th.querySelector('.slds-assistive-text').textContent.trim()).toBe('Related records');
        expect($('table').getAttribute('aria-colcount')).toBe('4');
        expect(cell(id(1), 'Name').getAttribute('aria-colindex')).toBe('2');
        expect($$('td[data-field="__expand"] button')).toHaveLength(3);
        const button = toggle(id(1));
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.hasAttribute('aria-controls')).toBe(false);
        expect(button.textContent.trim()).toBe('Show related records for Kennebec Lumber, 12 bundles');
        // Out of the tab order until its cell is in actionable mode.
        expect(button.getAttribute('tabindex')).toBe('-1');
    });

    it('comes after the selection column', async () => {
        await mount({ selection: 'multi' });
        expect($('th[data-field="__select"]').getAttribute('aria-colindex')).toBe('1');
        expect($('th[data-field="__expand"]').getAttribute('aria-colindex')).toBe('2');
    });
});

describe('opening a row', () => {
    it("puts a panel row after it, one cell across every column, holding the row's tabs", async () => {
        await mount();
        await open(id(1));
        expect(rowOrder()).toEqual([id(1), detailId(id(1)), id(2), id(3)]);
        const tr = $('tbody tr[data-kind="detail"]');
        expect(tr.style.height).toBe(DETAIL_HEIGHT + 'px');
        const td = detailCell(id(1));
        expect(td.getAttribute('colspan')).toBe('4');
        expect(td.getAttribute('aria-colindex')).toBe('1');
        expect(td.getAttribute('aria-label')).toBe('Related records for Kennebec Lumber, 12 bundles');
        const children = td.querySelector('c-grid-child-tabs');
        expect(children.tabs).toEqual(CHILDREN);
        expect(children.parentId).toBe(id(1));
        expect(children.parentName).toBe('Kennebec Lumber, 12 bundles');
        expect(children.level).toBe(2);
        // One child grid per tab, each limited to this row's records.
        const views = children.shadowRoot.querySelectorAll('c-grid-view');
        expect([...views].map(v => v.configName)).toEqual(['Consignment_Items', 'Inspections']);
        expect(views[0].parent).toEqual({
            link: 'Consignments_Items',
            id: id(1),
            name: 'Kennebec Lumber, 12 bundles',
            level: 2,
            height: null
        });
    });

    it('marks the toggle open, points it at the panel and says so', async () => {
        await mount();
        await open(id(1));
        const button = toggle(id(1));
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(button.getAttribute('aria-controls')).toBe(detailCell(id(1)).id);
        expect(button.textContent.trim()).toBe('Hide related records for Kennebec Lumber, 12 bundles');
        expect(announcement()).toBe('Showing related records for Kennebec Lumber, 12 bundles');
    });

    it('numbers the panel row as a row, and counts it (HR-10)', async () => {
        await mount();
        await open(id(2));
        expect($$('tbody tr[role="row"]').map(tr => tr.getAttribute('aria-rowindex'))).toEqual(['2', '3', '4', '5']);
        expect($('table').getAttribute('aria-rowcount')).toBe('5');
    });

    it('closes again, and says so', async () => {
        await mount();
        await open(id(1));
        await open(id(1));
        expect(rowOrder()).toEqual([id(1), id(2), id(3)]);
        expect(toggle(id(1)).getAttribute('aria-expanded')).toBe('false');
        expect(announcement()).toBe('Hid related records for Kennebec Lumber, 12 bundles');
    });

    it('keeps several rows open at once, each panel after its row, through a sort', async () => {
        await mount();
        await open(id(1));
        await open(id(3));
        expect(rowOrder()).toEqual([id(1), detailId(id(1)), id(2), id(3), detailId(id(3))]);
        $('th[data-field="Freight_Charge__c"] .slds-th__action').click(); // ascending by Freight Charge
        await flush();
        expect(rowOrder()).toEqual([id(3), detailId(id(3)), id(1), detailId(id(1)), id(2)]);
    });

    it('has no axe violations with a panel open', async () => {
        await mount({ selection: 'multi' });
        await open(id(2));
        await expect(el).toBeAccessible();
    });

    it('hands the next level down to a nested table, in a shorter panel', async () => {
        await mount({ level: 2 });
        await open(id(1));
        expect(detailCell(id(1)).querySelector('c-grid-child-tabs').level).toBe(3);
        expect($('tbody tr[data-kind="detail"]').style.height).toBe(NESTED_DETAIL_HEIGHT + 'px');
    });

    it('gives a group row no toggle, and Enter on its toggle cell opens nothing', async () => {
        await mount({ grouping: [{ field: 'Service_Level__c', unit: null }] });
        const groupTr = $('tbody tr[data-kind="group"]');
        const groupToggleCell = groupTr.querySelector('td[data-field="__expand"]');
        expect(groupToggleCell).not.toBeNull();
        expect(groupToggleCell.querySelector('button')).toBeNull();
        await focusOn(groupToggleCell);
        await key(groupToggleCell, 'Enter');
        expect($('tbody tr[data-kind="detail"]')).toBeNull();
    });
});

describe('panel details', () => {
    const COUNTS = {
        [id(1)]: { total: 3, byTab: { Consignments_Items: 2, Consignments_Inspections: 1 } },
        [id(2)]: { total: 0, byTab: { Consignments_Items: 0, Consignments_Inspections: 0 } }
    };

    it('shows how many related records a row has, beside its toggle, and says it', async () => {
        await mount({ childCounts: COUNTS });
        const td = cell(id(1), '__expand');
        expect(td.querySelector('.rh-expand-count').textContent).toBe('3');
        expect(td.querySelector('.rh-expand-count').getAttribute('aria-hidden')).toBe('true');
        expect(toggle(id(1)).querySelector('.slds-assistive-text').textContent).toBe(
            'Show related records for Kennebec Lumber, 12 bundles (3)'
        );
    });

    it("offers no toggle while a row's count is on the way, so rows with none never flash one", async () => {
        // Rows first, counts not yet: no row offers a toggle.
        await mount({ childCounts: {} });
        expect($$('td[data-field="__expand"] button')).toHaveLength(0);
        expect($$('td[data-field="__expand"]')).toHaveLength(3); // the column stays, so nothing moves
        // The counts arrive: only the row with related records gains one.
        el.config = { ...el.config, childCounts: COUNTS };
        await flush();
        expect(toggle(id(1))).not.toBeNull();
        expect(toggle(id(2))).toBeNull();
        expect(toggle(id(3))).toBeNull(); // not in the answer yet: still on the way
    });

    it('offers every toggle, without a count, when the counts could not be fetched', async () => {
        await mount({ childCounts: COUNTS, childCountsFailed: true });
        expect(toggle(id(3))).not.toBeNull();
        expect(cell(id(3), '__expand').querySelector('.rh-expand-count')).toBeNull();
        expect(toggle(id(3)).querySelector('.slds-assistive-text').textContent).toBe(
            'Show related records for Penobscot Paper, full truck'
        );
        // A known count still decides its row.
        expect(toggle(id(2))).toBeNull();
    });

    it('offers every toggle when no counts are asked for', async () => {
        await mount({});
        expect($$('td[data-field="__expand"] button')).toHaveLength(3);
    });

    it('offers no toggle for a row with no related records; Enter on it says so', async () => {
        await mount({ childCounts: COUNTS });
        expect(toggle(id(2))).toBeNull();
        const td = await focusOn(cell(id(2), '__expand'));
        await key(td, 'Enter');
        expect(detailCell(id(2))).toBeNull();
        expect(announcement()).toBe('No related records.');
    });

    it("hands the open row's counts to its tabs", async () => {
        await mount({ childCounts: COUNTS });
        await open(id(1));
        expect(detailCell(id(1)).querySelector('c-grid-child-tabs').counts).toEqual({
            Consignments_Items: 2,
            Consignments_Inspections: 1
        });
    });

    it("sizes the panel to what it holds, up to its level's maximum", async () => {
        await mount();
        await open(id(1));
        const row = () => $(`tr[data-row-id="${detailId(id(1))}"]`);
        expect(row().style.height).toBe(`${DETAIL_HEIGHT}px`); // not measured yet
        detailCell(id(1))
            .querySelector('c-grid-child-tabs')
            .dispatchEvent(new CustomEvent('panelsize', { detail: { height: 200 } }));
        await flush();
        const want = panelHeightFor(200, 1);
        expect(want).toBeLessThan(DETAIL_HEIGHT);
        expect(row().style.height).toBe(`${want}px`);
        expect(detailCell(id(1)).querySelector('.rh-detail-panel').style.height).toBe(`${want - 1}px`);
        // A child grid far taller than the panel still stops at the maximum.
        detailCell(id(1))
            .querySelector('c-grid-child-tabs')
            .dispatchEvent(new CustomEvent('panelsize', { detail: { height: 2000 } }));
        await flush();
        expect(row().style.height).toBe(`${DETAIL_HEIGHT}px`);
    });

    it("indents the panel under the row's toggle", async () => {
        await mount({ selection: 'multi' });
        await open(id(1));
        const panel = detailCell(id(1)).querySelector('.rh-detail-panel');
        expect(panel.style.getPropertyValue('--rh-panel-indent')).toBe(`${32 + 12}px`); // the checkbox column, then to the toggle's middle
    });

    it("passes a child table's new count up, with the row it belongs to", async () => {
        await mount({ childCounts: COUNTS });
        const heard = [];
        el.addEventListener('childcount', e => heard.push(e.detail));
        await open(id(1));
        detailCell(id(1))
            .querySelector('c-grid-child-tabs')
            .dispatchEvent(new CustomEvent('childcount', { detail: { tab: 'Consignments_Inspections', count: 4 } }));
        expect(heard).toEqual([{ parentId: id(1), tab: 'Consignments_Inspections', count: 4 }]);
    });

    it('tints the open row, so the panel under it reads as its own', async () => {
        await mount();
        await open(id(1));
        expect($(`tr[data-row-id="${id(1)}"]`).classList).toContain('rh-row_open');
        expect($(`tr[data-row-id="${id(2)}"]`).classList).not.toContain('rh-row_open');
    });
});

describe('keys', () => {
    it('Enter or Space on a toggle cell opens and closes the row', async () => {
        await mount();
        const td = await focusOn(cell(id(1), '__expand'));
        await key(td, 'Enter');
        expect(detailCell(id(1))).not.toBeNull();
        await key(cell(id(1), '__expand'), ' ');
        expect(detailCell(id(1))).toBeNull();
    });

    it('arrows reach the panel as one cell, and leave it in the column they came from', async () => {
        await mount();
        await open(id(1));
        await focusOn(cell(id(1), 'Freight_Charge__c'));
        await key(cell(id(1), 'Freight_Charge__c'), 'ArrowDown');
        expect(el.shadowRoot.activeElement).toBe(detailCell(id(1)));
        await key(detailCell(id(1)), 'ArrowRight');
        expect(el.shadowRoot.activeElement).toBe(detailCell(id(1)));
        await key(detailCell(id(1)), 'ArrowDown');
        expect(el.shadowRoot.activeElement).toBe(cell(id(2), 'Freight_Charge__c'));
    });

    it("Enter on the panel goes into the open tab's grid", async () => {
        await mount();
        await open(id(1));
        const td = await focusOn(detailCell(id(1)));
        const children = td.querySelector('c-grid-child-tabs');
        const spy = jest.spyOn(children, 'focus');
        await key(td, 'Enter');
        expect(spy).toHaveBeenCalled();
    });

    it('closing a row with focus in its panel puts focus on its toggle', async () => {
        await mount();
        await open(id(1));
        await focusOn(detailCell(id(1)));
        // The toggle is reached with the mouse here; the keys are covered above.
        toggle(id(1)).click();
        await flush();
        await flush();
        expect(detailCell(id(1))).toBeNull();
        expect(el.shadowRoot.activeElement.closest('td').dataset.field).toBe('__expand');
    });

    it('Space on the panel selects nothing', async () => {
        await mount({ selection: 'multi' });
        await open(id(1));
        const td = await focusOn(detailCell(id(1)));
        await key(td, ' ');
        expect(events.selectionchange).toHaveLength(0);
    });
});

describe("a child grid's own events", () => {
    it('its keys are its own: the parent table does not move', async () => {
        await mount();
        await open(id(1));
        const td = await focusOn(detailCell(id(1)));
        const event = await key(td.querySelector('c-grid-child-tabs'), 'ArrowDown');
        expect(event.defaultPrevented).toBe(false);
        expect(el.shadowRoot.activeElement).toBe(td);
    });

    it('an Escape it had no use for comes back out to the panel; one it used does not', async () => {
        await mount();
        await open(id(1));
        const td = await focusOn(detailCell(id(1)));
        const children = td.querySelector('c-grid-child-tabs');
        td.blur();
        await flush();
        const used = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true });
        used.preventDefault();
        children.dispatchEvent(used);
        await flush();
        expect(el.shadowRoot.activeElement).not.toBe(td);
        await key(children, 'Escape');
        expect(el.shadowRoot.activeElement).toBe(td);
    });

    it("its paste is its own: nothing is pasted into the parent's focused cell", async () => {
        await mount();
        await open(id(1));
        await focusOn(cell(id(2), 'Name'));
        const paste = new CustomEvent('paste', { bubbles: true, composed: true, cancelable: true });
        paste.clipboardData = { getData: () => 'Quabbin Supply, 2 pallets' };
        detailCell(id(1)).querySelector('c-grid-child-tabs').dispatchEvent(paste);
        await flush();
        expect(paste.defaultPrevented).toBe(false);
        expect(events.cellschange).toHaveLength(0);
    });
});

describe('the spreadsheet keys over a range with a panel in it', () => {
    const selectDown = async () => {
        await focusOn(cell(id(1), 'Freight_Charge__c'));
        await key(cell(id(1), 'Freight_Charge__c'), 'ArrowDown', { shiftKey: true });
        await key(el.shadowRoot.activeElement, 'ArrowDown', { shiftKey: true });
        expect(el.shadowRoot.activeElement).toBe(cell(id(2), 'Freight_Charge__c'));
    };

    it('Delete clears the records and leaves the panel alone', async () => {
        await mount();
        await open(id(1));
        await selectDown();
        await key(cell(id(2), 'Freight_Charge__c'), 'Delete');
        expect(events.cellschange).toHaveLength(1);
        expect(events.cellschange[0].changes.map(c => [c.recordId, c.field])).toEqual([
            [id(1), 'Freight_Charge__c'],
            [id(2), 'Freight_Charge__c']
        ]);
    });

    it('fill down copies over the panel to the record below it', async () => {
        await mount();
        await open(id(1));
        await selectDown();
        await key(cell(id(2), 'Freight_Charge__c'), 'd', { ctrlKey: true });
        expect(events.cellschange).toHaveLength(1);
        expect(events.cellschange[0].changes.map(c => [c.recordId, c.field, c.value])).toEqual([
            [id(2), 'Freight_Charge__c', 100]
        ]);
    });

    it('fill down will not start from a panel', async () => {
        await mount();
        await open(id(1));
        await focusOn(detailCell(id(1)));
        await key(detailCell(id(1)), 'ArrowDown', { shiftKey: true });
        await key(el.shadowRoot.activeElement, 'd', { ctrlKey: true });
        expect(events.cellschange).toHaveLength(0);
        expect(announcement()).toBe('Fill down starts from a record, not its related records.');
    });
});

describe('windowing with a panel open', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
        Id: 'a00' + String(i).padStart(15, '0'),
        Name: 'Kennebec Lumber, load ' + (i + 1),
        Service_Level__c: 'Standard',
        Freight_Charge__c: i
    }));
    const rowHeight = 33; // the default until measured; JSDOM has no layout

    it('renders the rows that fit around the taller panel, and sizes the spacer below from the offsets', async () => {
        await mount({ rows: many, totalRows: many.length });
        await open(many[0].Id);
        const details = [1];
        // The box fills the window, and the rows are windowed for that height.
        const viewport = parseInt($('[data-scroller]').style.maxHeight, 10);
        // The last row in view comes from the offsets: the panel is taller than a
        // row, so far fewer rows fit than the box's height over a row's.
        const lastVisible = rowAt(viewport, 201, rowHeight, details);
        expect(lastVisible).toBeLessThan(Math.floor(viewport / rowHeight));
        const end = lastVisible + 1 + 20;
        expect($$('tbody tr[role="row"]')).toHaveLength(end);
        const spacer = $$('tbody tr.rh-spacer td').pop();
        expect(spacer.style.height).toBe(`${rowTop(201, rowHeight, details) - rowTop(end, rowHeight, details)}px`);
    });

    it('finds the first row in view from the offsets as it scrolls', async () => {
        await mount({ rows: many, totalRows: many.length });
        await open(many[0].Id);
        const scroller = $('[data-scroller]');
        scroller.scrollTop = rowTop(32, rowHeight, [1]); // the top of row 32 (0-based)
        scroller.dispatchEvent(new CustomEvent('scroll'));
        await frame();
        await flush();
        const first = $('tbody tr[role="row"]');
        expect(first.getAttribute('aria-rowindex')).toBe(String(32 - 20 + 2));
        expect($('tbody tr.rh-spacer td').style.height).toBe(`${rowTop(12, rowHeight, [1])}px`);
    });
});

describe('a sideways scroll', () => {
    it("moves open rows' panels with it, through a variable on the tbody, not a render", async () => {
        await mount();
        await open(id(1));
        const scroller = $('[data-scroller]');
        scroller.scrollLeft = 150;
        scroller.dispatchEvent(new CustomEvent('scroll'));
        expect($('tbody').style.getPropertyValue('--rh-scroll-left')).toBe('150px');
        await flush();
        // A render does not wipe it: the tbody's style is not bound in the template.
        await open(id(2));
        expect($('tbody').style.getPropertyValue('--rh-scroll-left')).toBe('150px');
    });

    it("the panel is not position: sticky, which would trap a child grid's dialogs under the parent's rows", () => {
        // Found in Lightning Experience: the import dialog of a
        // child grid was painted over by the next parent row, its buttons hidden.
        const css = fs
            .readFileSync(path.join(__dirname, '..', 'gridTable.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const rule = css.match(/\.rh-detail-panel\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).not.toMatch(/position\s*:/);
        // A margin follows the scroll, plus the indent under the row's toggle.
        expect(rule[1]).toMatch(/margin-left:\s*calc\(var\(--rh-scroll-left[^;]*var\(--rh-panel-indent/);
    });
});

describe("a child grid's dialogs escape the parent table", () => {
    // Found in Lightning Experience: SLDS's transform on a
    // fixed-layout tbody made it the frame of a child grid's position: fixed
    // dialog, which was clipped to the parent's scroller.
    const css = () =>
        fs.readFileSync(path.join(__dirname, '..', 'gridTable.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    it('marks a table with child tables, and only such a table', async () => {
        await mount();
        expect($('table').classList).toContain('rh-table_parent');
        await mount({ children: [] });
        expect($('table').classList).not.toContain('rh-table_parent');
    });

    it("drops the transform on that table's own tbody", () => {
        const rule = css().match(/\.rh-table_parent\s*>\s*tbody\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/transform:\s*none/);
    });

    it('leaves the tables inside its panels alone', () => {
        // Every grid is a gridTable, so the styles are the same component's: a
        // descendant selector would also reach the tbody of each child table in
        // an open panel.
        expect(css()).not.toMatch(/\.rh-table_parent\s+tbody/);
    });
});

describe('cards', () => {
    const cardItems = () => $$('li.rh-card');

    it('gives each record card a toggle that opens its tables under it', async () => {
        await mount({ layout: 'cards' });
        const button = $(`li[data-row-id="${id(1)}"] .rh-card-expand`);
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.textContent.trim()).toBe('Show related records for Kennebec Lumber, 12 bundles');
        button.click();
        await flush();
        expect(cardItems().map(li => li.dataset.rowId)).toEqual([id(1), detailId(id(1)), id(2), id(3)]);
        const region = $('.rh-card-panel');
        expect(region.getAttribute('role')).toBe('region');
        expect(region.getAttribute('aria-label')).toBe('Related records for Kennebec Lumber, 12 bundles');
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(button.getAttribute('aria-controls')).toBe(region.id);
        expect(region.querySelector('c-grid-child-tabs').parentId).toBe(id(1));
        // The toggle keeps focus: it is the same button after the render.
        expect($(`li[data-row-id="${id(1)}"] .rh-card-expand`)).toBe(button);
    });

    it('counts records, not panels', async () => {
        await mount({ layout: 'cards' });
        $(`li[data-row-id="${id(1)}"] .rh-card-expand`).click();
        await flush();
        expect($('.rh-card-count').textContent).toBe('Showing 3 of 3');
    });

    it('has no toggle without child tables', async () => {
        await mount({ layout: 'cards', children: [] });
        expect($('.rh-card-expand')).toBeNull();
    });

    it("offers a card's toggle only once its count says it has related records", async () => {
        await mount({ layout: 'cards', childCounts: {} });
        expect($('.rh-card-expand')).toBeNull();
        el.config = {
            ...el.config,
            childCounts: {
                [id(1)]: { total: 2, byTab: { Consignments_Items: 2 } },
                [id(2)]: { total: 0, byTab: {} }
            }
        };
        await flush();
        expect($$('.rh-card-expand').map(b => b.closest('li').dataset.rowId)).toEqual([id(1)]);
        el.config = { ...el.config, childCountsFailed: true };
        await flush();
        expect($$('.rh-card-expand').map(b => b.closest('li').dataset.rowId)).toEqual([id(1), id(3)]);
    });
});

describe("every row at once, and the admin's heights", () => {
    const COUNTS = {
        [id(1)]: { total: 2, byTab: { Consignments_Items: 2, Consignments_Inspections: 0 } },
        [id(2)]: { total: 0, byTab: { Consignments_Items: 0, Consignments_Inspections: 0 } },
        [id(3)]: { total: 1, byTab: { Consignments_Items: 1, Consignments_Inspections: 0 } }
    };
    const allButton = () => $('th[data-field="__expand"] .rh-expand-all');

    it('opens every row with related records from the header, and closes them all again', async () => {
        await mount({ childCounts: COUNTS });
        expect(allButton().title).toBe('Show related records for every row');
        expect(allButton().getAttribute('aria-pressed')).toBe('false');
        allButton().click();
        await flush();
        expect(rowOrder()).toEqual([id(1), detailId(id(1)), id(2), id(3), detailId(id(3))]);
        expect(announcement()).toBe('Showing related records for 2 rows');
        expect(allButton().title).toBe('Hide related records for every row');
        expect(allButton().getAttribute('aria-pressed')).toBe('true');
        allButton().click();
        await flush();
        expect(rowOrder()).toEqual([id(1), id(2), id(3)]);
        expect(announcement()).toBe('Hid related records for every row');
    });

    it("does the same with Enter on the toggle column's header", async () => {
        await mount({ childCounts: COUNTS });
        await key(await focusOn($('th[data-field="__expand"]')), 'Enter');
        expect(rowOrder()).toEqual([id(1), detailId(id(1)), id(2), id(3), detailId(id(3))]);
    });

    it('offers no button when no row has related records', async () => {
        await mount({
            childCounts: {
                [id(1)]: { total: 0, byTab: {} },
                [id(2)]: { total: 0, byTab: {} },
                [id(3)]: { total: 0, byTab: {} }
            }
        });
        expect(allButton()).toBeNull();
    });

    it('makes the panel as tall as the tallest tab the admin gave a Height, and hands that Height to the tab', async () => {
        const tall = [{ ...CHILDREN[0], height: 600 }, CHILDREN[1]];
        await mount({ children: tall });
        await open(id(1));
        // Unmeasured, the panel is its maximum: the tab's 600px and the panel's chrome.
        expect(detailCell(id(1)).closest('tr').style.height).toBe(`${600 + 152}px`);
        const views = detailCell(id(1)).querySelector('c-grid-child-tabs').shadowRoot.querySelectorAll('c-grid-view');
        expect(views[0].parent.height).toBe(600);
        expect(views[1].parent.height).toBeNull();
    });
});
