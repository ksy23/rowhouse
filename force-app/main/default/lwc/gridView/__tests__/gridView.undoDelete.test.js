/**
 * Undo after a delete, and deleting every matching record.
 */
import { createElement } from 'lwc';
import GridView, { DELETE_BATCH, MATCH_SLICE } from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import deleteRows from '@salesforce/apex/GridController.deleteRows';
import restoreRows from '@salesforce/apex/GridController.restoreRows';
import matchingIds from '@salesforce/apex/GridController.matchingIds';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.deleteRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.restoreRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.matchingIds', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn(() => Promise.resolve({})) }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), { virtual: true });

const DEFINITION = {
    name: 'Test_Records',
    label: 'Test Records',
    objectApiName: 'Rowhouse_Test_Record__c',
    objectLabel: 'Rowhouse Test Records',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    allowMassDelete: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
        { field: 'Number_Field__c', label: 'Number', type: 'number', editable: true, sortable: true, scale: 2 }
    ]
};
const row = i => ({ Id: 'a00' + String(i).padStart(15, '0'), Name: 'Row ' + i, Number_Field__c: String(i) });
const page = (rows, total = rows.length) => ({ rows, hasMore: false, cursorLocator: null, cursorToken: null, totalRows: total, serverMs: 5, cpuMs: 3 });
const settle = async () => {
    for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const table = el => $(el, 'c-grid-table');
const select = (el, ids) => table(el).dispatchEvent(new CustomEvent('selectionchange', { detail: { selectedIds: ids } }));
let toasts;
function mount() {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Test_Records';
    toasts = [];
    el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
    document.body.appendChild(el);
    return el;
}
const deleteSelected = async el => {
    $(el, '.rh-mass-delete').click();
    await settle();
    $(el, 'c-grid-delete-dialog').dispatchEvent(new CustomEvent('confirm'));
    await settle();
};

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    jest.useFakeTimers();
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue(page([row(1), row(2), row(3)]));
    deleteRows.mockImplementation(({ recordIds }) => Promise.resolve({ deletedIds: recordIds, errors: [] }));
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('undo after a delete', () => {
    it('says what was deleted under the header, with Undo, instead of a toast', async () => {
        const el = mount();
        await settle();
        expect($(el, '.rh-undo-delete')).toBeNull();
        select(el, [row(1).Id, row(2).Id]);
        await settle();
        await deleteSelected(el);
        expect(toasts).toEqual([]);
        const bar = $(el, '.rh-undo-delete');
        expect(bar.getAttribute('role')).toBe('status');
        expect($(el, '.rh-undo-delete-text').textContent).toBe('Deleted 2 records. They are in the Recycle Bin.');
        expect($(el, '.rh-undo-delete-button').label).toBe('Undo');
    });

    it('puts the records back from the Recycle Bin and loads the grid again', async () => {
        restoreRows.mockImplementation(({ recordIds }) => Promise.resolve({ restoredIds: recordIds, errors: [] }));
        const el = mount();
        await settle();
        select(el, [row(1).Id, row(2).Id]);
        await settle();
        await deleteSelected(el);
        expect(table(el).config.rows).toHaveLength(1);
        const loads = fetchRows.mock.calls.length + openGrid.mock.calls.length;
        $(el, '.rh-undo-delete-button').click();
        await settle();
        expect(restoreRows).toHaveBeenCalledWith({ configName: 'Test_Records', recordIds: [row(1).Id, row(2).Id] });
        expect(toasts).toEqual([{ title: 'Undone', message: 'Put back 2 records.', variant: 'success' }]);
        expect($(el, '.rh-undo-delete')).toBeNull();
        expect(fetchRows.mock.calls.length + openGrid.mock.calls.length).toBeGreaterThan(loads);
    });

    it('says which records could not be put back', async () => {
        restoreRows.mockResolvedValue({ restoredIds: [row(1).Id], errors: [{ recordId: row(2).Id, message: 'Entity is not in the recycle bin' }] });
        const el = mount();
        await settle();
        select(el, [row(1).Id, row(2).Id]);
        await settle();
        await deleteSelected(el);
        $(el, '.rh-undo-delete-button').click();
        await settle();
        expect(toasts).toEqual([{
            title: 'Undo incomplete',
            message: 'Put back 1 record. 1 could not be: Entity is not in the recycle bin',
            variant: 'warning'
        }]);
    });

    it('goes away when closed', async () => {
        const el = mount();
        await settle();
        select(el, [row(1).Id]);
        await settle();
        await deleteSelected(el);
        expect($(el, '.rh-undo-delete-text').textContent).toBe('Deleted 1 record. It is in the Recycle Bin.');
        $(el, '.rh-undo-delete-close').click();
        await settle();
        expect($(el, '.rh-undo-delete')).toBeNull();
        expect(restoreRows).not.toHaveBeenCalled();
    });
});

describe('every matching record', () => {
    const many = Array.from({ length: 3 }, (_, i) => row(i + 1));

    it('is offered once every loaded row is selected and more records match', async () => {
        fetchRows.mockResolvedValue(page(many, 4500));
        const el = mount();
        await settle();
        select(el, [many[0].Id]);
        await settle();
        expect($(el, '.rh-select-all-matching')).toBeNull(); // not every loaded row
        select(el, many.map(r => r.Id));
        await settle();
        const link = $(el, '.rh-select-all-matching');
        expect(link.label).toBe('Select all 4,500 matching records');
        link.click();
        await settle();
        expect($(el, '.rh-selection-count').textContent).toBe('All 4,500 matching records selected');
        expect($(el, '.rh-select-all-matching')).toBeNull();
        expect($(el, '.rh-mass-edit').disabled).toBe(true); // loaded rows only
        expect($(el, '.rh-mass-delete').disabled).toBe(false);
        // Changing the selection by hand goes back to the rows ticked.
        select(el, [many[0].Id]);
        await settle();
        expect($(el, '.rh-selection-count').textContent).toBe('1 selected');
    });

    it('is not offered where every match is loaded, or where the grid does not delete', async () => {
        const el = mount();
        await settle();
        select(el, [row(1).Id, row(2).Id, row(3).Id]);
        await settle();
        expect($(el, '.rh-select-all-matching')).toBeNull();
        el.remove();
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, allowMassDelete: false }, diagnostics: false });
        fetchRows.mockResolvedValue(page(many, 4500));
        const other = mount();
        await settle();
        select(other, many.map(r => r.Id));
        await settle();
        expect($(other, '.rh-select-all-matching')).toBeNull();
    });

    it('deletes every match: slice by slice from the server, batch by batch, then loads again', async () => {
        fetchRows.mockResolvedValue(page(many, 2100));
        const ids = Array.from({ length: 2100 }, (_, i) => row(i + 1).Id);
        matchingIds.mockImplementation(({ afterId }) => {
            const from = afterId ? ids.indexOf(afterId) + 1 : 0;
            return Promise.resolve({ ids: ids.slice(from, from + MATCH_SLICE) });
        });
        const el = mount();
        await settle();
        select(el, many.map(r => r.Id));
        await settle();
        $(el, '.rh-select-all-matching').click();
        await settle();
        $(el, '.rh-mass-delete').click();
        await settle();
        const ask = $(el, 'c-grid-delete-dialog');
        expect(ask.count).toBe(2100);
        expect(ask.matching).toBe(true);
        expect(ask.names).toEqual(['Row 1', 'Row 2', 'Row 3']);
        const loads = fetchRows.mock.calls.length + openGrid.mock.calls.length;
        ask.dispatchEvent(new CustomEvent('confirm'));
        await settle();
        await settle();
        expect(matchingIds.mock.calls.map(([args]) => args.afterId)).toEqual([null, ids[MATCH_SLICE - 1]]);
        expect(matchingIds.mock.calls[0][0]).toMatchObject({ configName: 'Test_Records', searchTerm: null });
        expect(deleteRows).toHaveBeenCalledTimes(Math.ceil(MATCH_SLICE / DELETE_BATCH) + 1);
        expect($(el, '.rh-undo-delete-text').textContent).toBe('Deleted 2,100 records. They are in the Recycle Bin.');
        expect(fetchRows.mock.calls.length + openGrid.mock.calls.length).toBeGreaterThan(loads);
    });

    it('says the first reason when some matching records could not be deleted', async () => {
        fetchRows.mockResolvedValue(page(many, 30));
        matchingIds.mockResolvedValue({ ids: many.map(r => r.Id) });
        deleteRows.mockResolvedValue({
            deletedIds: [many[0].Id, many[1].Id],
            errors: [{ recordId: many[2].Id, message: 'insufficient access rights on object id' }]
        });
        const el = mount();
        await settle();
        select(el, many.map(r => r.Id));
        await settle();
        $(el, '.rh-select-all-matching').click();
        await settle();
        await deleteSelected(el);
        expect(toasts[0]).toEqual({
            title: 'Deleted with errors',
            message: 'Deleted 2 records. 1 could not be deleted: insufficient access rights on object id',
            variant: 'warning'
        });
    });
});
