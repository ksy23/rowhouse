/**
 * Each user's own columns, kept with their layout. Shared
 * set-up below is the layout tests' own.
 *
 * Each user's layout. A top-level grid reads the user's saved layout
 * beside its configuration and starts with its sort, grouping, widths, Wrap
 * or Clip and open rows, as far as they still fit the grid. A change to any
 * of them is kept LAYOUT_DELAY_MS after the last one, and at once if the grid
 * goes away first. Reset layout forgets it and puts back the admin's. A
 * layout that cannot be read or kept changes nothing for the user. The
 * user's filters are never part of it, and a child table keeps none.
 */
import { createElement } from 'lwc';
import GridView, { LAYOUT_DELAY_MS } from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import summarizeGroups from '@salesforce/apex/GridController.summarizeGroups';
import getLayout from '@salesforce/apex/GridController.getLayout';
import saveLayout from '@salesforce/apex/GridController.saveLayout';
import resetLayout from '@salesforce/apex/GridController.resetLayout';
import { toCsv } from 'c/gridCsv';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRowsById', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.save', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.deleteRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.runAction', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.getLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.resetLayout', () => ({ default: jest.fn() }), { virtual: true });
// Export is checked at its boundary: what gridView hands to gridCsv.
jest.mock('c/gridCsv', () => ({ toCsv: jest.fn(() => 'csv'), downloadCsv: jest.fn(() => true) }));

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
    { field: 'Amount__c', label: 'Amount', type: 'currency', editable: true, sortable: true, scale: 2 },
    { field: 'Stage__c', label: 'Stage', type: 'picklist', editable: true, sortable: true, groupable: true },
    { field: 'Close__c', label: 'Close', type: 'date', editable: true, sortable: true, groupable: true },
    { field: 'Notes__c', label: 'Notes', type: 'textarea', editable: true, sortable: false }
];
// The admin's sort is by Name; the admin sets no grouping.
const DEFINITION = {
    name: 'Test_Records',
    label: 'Test Records',
    objectApiName: 'Rowhouse_Test_Record__c',
    objectLabel: 'Rowhouse Test Records',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    allowCsvExport: true,
    columns: COLUMNS
};
const ADMIN_SORT = [{ field: 'Name', direction: 'asc' }];

const row = i => ({ Id: 'a00' + String(i).padStart(15, '0'), Name: 'Row ' + i, Amount__c: i, Stage__c: 'Open' });
const page = (rows, { hasMore = false, locator = null, total = rows.length } = {}) => ({
    rows,
    hasMore,
    cursorLocator: locator,
    cursorToken: null,
    totalRows: total
});

// Resolve every pending promise.
const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const table = el => $(el, 'c-grid-table');
const tableConfig = el => table(el).config;
const lastCall = mock => mock.mock.calls[mock.mock.calls.length - 1][0];
const live = el => $(el, '.rh-live').textContent;

/** What the last saveLayout call kept, read back. */
const keptLayout = () => JSON.parse(lastCall(saveLayout).layout);

function mount(configName = 'Test_Records') {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = configName;
    document.body.appendChild(el);
    return el;
}

function mountChild() {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Test_Children';
    el.parent = { link: 'Test_Records_Children', id: 'a00000000000000001', name: 'Row 1', level: 2 };
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, getLayout, fetchRows }));
    jest.useFakeTimers();
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue(page([row(1), row(2), row(3)]));
    summarizeGroups.mockResolvedValue({ groups: [], boundaries: null, tooManyGroups: false });
    getLayout.mockResolvedValue(null);
    saveLayout.mockResolvedValue(true);
    resetLayout.mockResolvedValue(undefined);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
    delete global.ResizeObserver;
});

describe("the user's own columns", () => {
    const columnsChange = (el, choice) =>
        table(el).dispatchEvent(new CustomEvent('columnschange', { detail: { choice } }));
    const dialog = el => $(el, 'c-grid-columns-dialog');
    const HIDE_NOTES = { order: ['Name', 'Amount__c', 'Stage__c', 'Close__c', 'Notes__c'], hidden: ['Notes__c'] };

    it('starts with the saved columns, and hands them to the table', async () => {
        getLayout.mockResolvedValue(JSON.stringify({ v: 1, sort: ADMIN_SORT, grouping: [], columns: HIDE_NOTES }));
        const el = mount();
        await settle();
        expect(tableConfig(el).columnChoice).toEqual(HIDE_NOTES);
        expect(tableConfig(el).columns).toEqual(COLUMNS); // every column: the table draws the choice
    });

    it('keeps a column hidden from its menu, with the rest of the layout', async () => {
        const el = mount();
        await settle();
        expect(tableConfig(el).columnChoice).toBeNull();
        columnsChange(el, HIDE_NOTES);
        await settle();
        expect(tableConfig(el).columnChoice).toEqual(HIDE_NOTES);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(keptLayout()).toEqual({ v: 1, sort: ADMIN_SORT, grouping: [], columns: HIDE_NOTES });
    });

    it('ignores a choice that changes nothing, and keeps none', async () => {
        const el = mount();
        await settle();
        columnsChange(el, { order: COLUMNS.map(c => c.field), hidden: [] });
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(tableConfig(el).columnChoice).toBeNull();
        expect(saveLayout).not.toHaveBeenCalled();
    });

    it('Choose columns opens the dialog; Save shows the columns chosen, in order, and keeps them', async () => {
        const el = mount();
        await settle();
        const button = $(el, '.rh-choose-columns');
        expect(button.alternativeText).toBe('Choose columns');
        button.click();
        await settle();
        expect(dialog(el).columns).toEqual(COLUMNS); // every column, to choose from
        expect(dialog(el).choice).toBeNull();
        dialog(el).dispatchEvent(new CustomEvent('save', { detail: { visible: ['Stage__c', 'Name', 'Amount__c'] } }));
        await settle();
        expect(dialog(el)).toBeNull();
        expect(tableConfig(el).columnChoice).toEqual({
            order: ['Stage__c', 'Name', 'Amount__c', 'Close__c', 'Notes__c'],
            hidden: ['Close__c', 'Notes__c']
        });
        expect(live(el)).toBe('Columns changed: 3 of 5 shown.');
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(keptLayout().columns.hidden).toEqual(['Close__c', 'Notes__c']);
    });

    it('Cancel changes nothing', async () => {
        const el = mount();
        await settle();
        $(el, '.rh-choose-columns').click();
        await settle();
        dialog(el).dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(dialog(el)).toBeNull();
        expect(tableConfig(el).columnChoice).toBeNull();
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(saveLayout).not.toHaveBeenCalled();
    });

    it('exports the columns the user sees, in their order, the record Id first', async () => {
        const el = mount();
        await settle();
        columnsChange(el, {
            order: ['Amount__c', 'Name', 'Stage__c', 'Close__c', 'Notes__c'],
            hidden: ['Stage__c', 'Close__c', 'Notes__c']
        });
        await settle();
        $(el, '.rh-export').click();
        await settle();
        const [, columns] = toCsv.mock.calls[0];
        expect(columns.map(c => c.field)).toEqual(['Id', 'Amount__c', 'Name']);
    });

    it("Reset layout puts back the admin's columns", async () => {
        getLayout.mockResolvedValue(JSON.stringify({ v: 1, sort: ADMIN_SORT, grouping: [], columns: HIDE_NOTES }));
        const el = mount();
        await settle();
        $(el, '.rh-reset-layout').click();
        await settle();
        expect(tableConfig(el).columnChoice).toBeNull();
    });

    it('is not offered on a grid of one column', async () => {
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, columns: [COLUMNS[0]] }, diagnostics: false });
        const el = mount();
        await settle();
        expect($(el, '.rh-choose-columns')).toBeNull();
    });

    it('lasts for the session on a child table, which keeps no layout', async () => {
        const el = mountChild();
        await settle();
        columnsChange(el, HIDE_NOTES);
        await settle();
        expect(tableConfig(el).columnChoice).toEqual(HIDE_NOTES);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        expect(saveLayout).not.toHaveBeenCalled();
    });
});
