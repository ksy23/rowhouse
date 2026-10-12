/**
 * An edit to one of several selected rows, for them all (the table's
 * applyselected, from the editor's "Update N selected items" or Ctrl+Enter):
 * as Update field, one undo step, unsaved until Save.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import fetchRowsById from '@salesforce/apex/GridController.fetchRowsById';
import deleteRows from '@salesforce/apex/GridController.deleteRows';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRowsById', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.deleteRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});

jest.mock('lightning/navigation', () => {
    // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    const Navigate = Symbol('Navigate');
    const GenerateUrl = Symbol('GenerateUrl');
    const NavigationMixin = Base =>
        class extends Base {
            [Navigate]() {}
            [GenerateUrl]() {
                return Promise.resolve('');
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const CALL = {
    name: 'Log_Call',
    label: 'Log a call',
    type: 'quickaction',
    onRow: true,
    onSelection: false,
    confirmation: null,
    flowName: null,
    inputName: null
};

const DEFINITION = {
    name: 'Consignments',
    label: 'Consignments',
    objectApiName: 'Consignment__c',
    objectLabel: 'Consignments',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    allowMassDelete: true,
    canEditRecords: true,
    canChangeOwner: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
        { field: 'Consignee__c', label: 'Consignee', type: 'text', editable: true, sortable: true }
    ],
    actions: [CALL]
};

const row = (i, extra = {}) => ({
    Id: 'a00' + String(i).padStart(15, '0'),
    Name: 'Penobscot Paper, load ' + i,
    Consignee__c: 'Wachusett Paper',
    ...extra
});
const page = rows => ({ rows, hasMore: false, cursorLocator: null, cursorToken: null, totalRows: rows.length });

const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

let toasts;
function mount() {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Consignments';
    toasts = [];
    el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
    document.body.appendChild(el);
    return el;
}
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const table = el => $(el, 'c-grid-table');

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue(page([row(1), row(2), row(3)]));
    fetchRowsById.mockImplementation(({ recordIds }) =>
        Promise.resolve(recordIds.map(id => ({ ...row(Number(id.slice(3))), Consignee__c: 'Quabbin Supply' })))
    );
    deleteRows.mockImplementation(({ recordIds }) => Promise.resolve({ deletedIds: recordIds, errors: [] }));
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

const select = async (el, ids) => {
    table(el).dispatchEvent(new CustomEvent('selectionchange', { detail: { selectedIds: ids } }));
    await settle();
};
const applySelected = async (el, detail) => {
    table(el).dispatchEvent(new CustomEvent('applyselected', { detail }));
    await settle();
};

it('gives every selected row the value, as unsaved edits, in one undo step', async () => {
    const el = mount();
    await settle();
    expect(table(el).config.bulkEdit).toBe(true);
    await select(el, [row(1).Id, row(3).Id]);
    await applySelected(el, { recordId: row(3).Id, field: 'Consignee__c', value: 'Casco Bay Marine' });
    const drafts = table(el).config.drafts;
    expect(drafts[row(1).Id]).toEqual({ Consignee__c: 'Casco Bay Marine' });
    expect(drafts[row(3).Id]).toEqual({ Consignee__c: 'Casco Bay Marine' });
    expect(drafts[row(2).Id]).toBeUndefined();
    expect(el.shadowRoot.querySelector('.rh-live').textContent).toContain(
        'Consignee changed on 2 rows. Save to keep it; Undo takes it back.'
    );
    expect(table(el).config.history.undoLabel).toBe('Undo edit of 2 cells');
});

it('gives only its own row the value when that row is not selected', async () => {
    const el = mount();
    await settle();
    await select(el, [row(1).Id, row(3).Id]);
    await applySelected(el, { recordId: row(2).Id, field: 'Consignee__c', value: 'Casco Bay Marine' });
    expect(Object.keys(table(el).config.drafts)).toEqual([row(2).Id]);
});

it('is not offered in a grid where nothing can be edited', async () => {
    getGridConfig.mockResolvedValue({
        definition: { ...DEFINITION, allowInlineEdit: false },
        diagnostics: false
    });
    const el = mount();
    await settle();
    expect(table(el).config.bulkEdit).toBe(false);
});
