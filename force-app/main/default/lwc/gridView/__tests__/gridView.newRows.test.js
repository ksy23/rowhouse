/**
 * The New button: a row at the top of the grid where a new record can be
 * one, saved with the grid's other changes; Salesforce's New form where it
 * cannot. openGrid's newRow says which.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import fetchRowsById from '@salesforce/apex/GridController.fetchRowsById';
import createRows from '@salesforce/apex/GridController.createRows';
import saveRows from '@salesforce/apex/GridController.save';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRowsById', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.createRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.save', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});

const USER_ID = '005000000000001AAA';
const DEFINITION = {
    name: 'Consignments',
    label: 'Consignments',
    objectApiName: 'Consignment__c',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, creatable: true, required: true, isName: true },
        { field: 'Status__c', label: 'Status', type: 'picklist', editable: true, creatable: true },
        { field: 'OwnerId', label: 'Owner', type: 'owner', editable: false, creatable: true },
        { field: 'Total__c', label: 'Total', type: 'number', editable: false, creatable: false }
    ]
};
const INLINE = {
    objectLabel: 'Consignment',
    inline: true,
    defaults: { Status__c: 'Open', OwnerId: USER_ID },
    names: { [USER_ID]: 'Hannah Pelletier' },
    presets: {}
};
const ROW = {
    Id: 'a00000000000000001',
    Name: 'Kennebec Lumber, 12 bundles',
    Status__c: 'Open',
    OwnerId: USER_ID,
    Total__c: '5'
};
const NEW_ID = 'a00000000000000009';
const settle = async () => {
    for (let i = 0; i < 30; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const tableOf = el => $(el, 'c-grid-table');
const config = el => tableOf(el).config;

const mount = async (newRow = INLINE, extra = {}) => {
    const base = openGridFrom({ getGridConfig, fetchRows });
    openGrid.mockImplementation(async args => ({ ...(await base(args)), newRow }));
    const el = createElement('c-grid-view', { is: GridView });
    Object.assign(el, { configName: 'Consignments', ...extra });
    document.body.appendChild(el);
    await settle();
    return el;
};
const clickNew = async el => {
    $(el, 'lightning-button.rh-new').click();
    await settle();
};
const typeIn = async (el, recordId, field, value) => {
    tableOf(el).dispatchEvent(
        new CustomEvent('cellchange', { detail: { recordId, field, value, originalValue: null } })
    );
    await settle();
};

beforeEach(() => {
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue({
        rows: [ROW],
        hasMore: false,
        cursorLocator: null,
        cursorToken: null,
        totalRows: 1,
        serverMs: 1,
        cpuMs: 1
    });
});
afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('the New button', () => {
    it('is there only when the server says this user may add records', async () => {
        const without = await mount(null);
        expect($(without, 'lightning-button.rh-new')).toBeNull();
        const withIt = await mount();
        const button = $(withIt, 'lightning-button.rh-new');
        expect(button.label).toBe('New');
        expect(button.title).toBe('New: add a row at the top of the grid, then save');
    });

    it("adds a row at the top with Salesforce's defaults, one undo step, and asks for its first cell to be focused", async () => {
        const el = await mount();
        await clickNew(el);
        const c = config(el);
        expect(c.newRows).toHaveLength(1);
        const row = c.newRows[0];
        expect(row.Id).toBe('rh-new-1');
        expect(row.Status__c).toBe('Open');
        expect(row.OwnerId).toBe(USER_ID);
        expect(c.refNames[USER_ID]).toBe('Hannah Pelletier'); // the owner's name shows in the cell
        expect(c.drafts['rh-new-1']).toEqual({ _new: true });
        expect(c.focusRow).toEqual({ id: 'rh-new-1', seq: 1 });
        expect(c.history.undoLabel).toBe('Undo new row');
        expect(c.rows).toEqual([ROW]); // the loaded rows are untouched
    });

    it('takes the row away again with Undo, and every new row with Cancel', async () => {
        const el = await mount();
        await clickNew(el);
        tableOf(el).dispatchEvent(new CustomEvent('undo'));
        await settle();
        expect(config(el).newRows).toHaveLength(0);
        tableOf(el).dispatchEvent(new CustomEvent('redo'));
        await settle();
        expect(config(el).newRows).toHaveLength(1);
        await clickNew(el);
        expect(config(el).newRows).toHaveLength(2);
        tableOf(el).dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(config(el).newRows).toHaveLength(0);
        expect(config(el).drafts).toEqual({});
    });

    it('creates the new rows first, then saves the changes, and reads the new records back into the grid', async () => {
        const el = await mount();
        await clickNew(el);
        await typeIn(el, 'rh-new-1', 'Name', 'Penobscot Paper, full truck');
        await typeIn(el, ROW.Id, 'Name', 'Kennebec Lumber, 14 bundles');
        createRows.mockResolvedValue({
            rows: [{ key: 'rh-new-1', success: true, recordId: NEW_ID, errors: [] }],
            rejectedFields: [],
            strippedFields: []
        });
        saveRows.mockResolvedValue({
            done: true,
            saveId: null,
            successCount: 1,
            errors: [],
            rejectedFields: [],
            strippedFields: []
        });
        fetchRowsById.mockImplementation(({ recordIds }) =>
            Promise.resolve(
                recordIds.map(id =>
                    id === NEW_ID
                        ? {
                              Id: NEW_ID,
                              Name: 'Penobscot Paper, full truck',
                              Status__c: 'Open',
                              OwnerId: USER_ID,
                              Total__c: '0'
                          }
                        : { ...ROW, Name: 'Kennebec Lumber, 14 bundles' }
                )
            )
        );
        const toasts = [];
        el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
        tableOf(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        await settle();
        expect(createRows).toHaveBeenCalledWith({
            configName: 'Consignments',
            rows: [{ key: 'rh-new-1', Name: 'Penobscot Paper, full truck', Status__c: 'Open', OwnerId: USER_ID }],
            parentLink: null,
            parentId: null,
            recordId: null
        });
        expect(saveRows).toHaveBeenCalledWith({
            configName: 'Consignments',
            rows: [{ Id: ROW.Id, Name: 'Kennebec Lumber, 14 bundles' }]
        });
        expect(createRows.mock.invocationCallOrder[0]).toBeLessThan(saveRows.mock.invocationCallOrder[0]);
        const c = config(el);
        expect(c.newRows).toHaveLength(0);
        expect(c.drafts).toEqual({});
        expect(c.rows.map(r => r.Id)).toEqual([NEW_ID, ROW.Id]);
        expect(toasts[toasts.length - 1].message).toBe('Saved 2 records.');
    });

    it('keeps a row that was not created, with why, and creates nothing for a blank required cell', async () => {
        const el = await mount();
        await clickNew(el);
        // Name is required and blank: nothing goes to the server.
        tableOf(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        expect(createRows).not.toHaveBeenCalled();
        expect(config(el).errors['rh-new-1'].fields.Name).toBe('Complete this field.');

        await typeIn(el, 'rh-new-1', 'Name', 'Casco Bay Marine, 3 pallets');
        createRows.mockResolvedValue({
            rows: [
                {
                    key: 'rh-new-1',
                    success: false,
                    recordId: null,
                    errors: [{ fieldName: null, message: 'Use one of these records?' }]
                }
            ],
            rejectedFields: [],
            strippedFields: []
        });
        tableOf(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        const c = config(el);
        expect(c.newRows).toHaveLength(1);
        expect(c.drafts['rh-new-1']).toEqual({ _new: true, Name: 'Casco Bay Marine, 3 pallets' });
        expect(c.errors['rh-new-1'].row).toBe('Use one of these records?');
        expect(fetchRowsById).not.toHaveBeenCalled();
    });

    it("opens Salesforce's New form where a new record cannot be a row, and adds the record it creates", async () => {
        const form = {
            objectLabel: 'Contact',
            inline: false,
            missing: ['Last Name'],
            defaults: {},
            names: {},
            presets: { AccountId: '001000000000001AAA' }
        };
        const el = await mount(form);
        expect($(el, 'lightning-button.rh-new').title).toBe("New: open Salesforce's New Contact form");
        await clickNew(el);
        const dialog = $(el, 'c-grid-new-record');
        expect(dialog.objectApiName).toBe('Consignment__c');
        expect(dialog.objectLabel).toBe('Contact');
        expect(dialog.fieldLabel).toBe('');
        expect(dialog.presets).toEqual({ AccountId: '001000000000001AAA' });
        expect(config(el).newRows).toHaveLength(0);
        // Cancel: focus goes back to the New button.
        const newButton = $(el, 'lightning-button.rh-new');
        newButton.focus = jest.fn();
        dialog.dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect($(el, 'c-grid-new-record')).toBeNull();
        expect(newButton.focus).toHaveBeenCalled();
        await clickNew(el);
        const again = $(el, 'c-grid-new-record');

        fetchRowsById.mockResolvedValue([{ Id: NEW_ID, Name: 'Whitcomb', Status__c: null, OwnerId: USER_ID }]);
        const toasts = [];
        el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
        again.dispatchEvent(new CustomEvent('created', { detail: { id: NEW_ID } }));
        await settle();
        expect($(el, 'c-grid-new-record')).toBeNull();
        expect(fetchRowsById).toHaveBeenCalledWith({ configName: 'Consignments', recordIds: [NEW_ID] });
        expect(config(el).rows.map(r => r.Id)).toEqual([NEW_ID, ROW.Id]);
        expect(config(el).focusRow.id).toBe(NEW_ID);
        expect(toasts[0].title).toBe('Contact "Whitcomb" was created.');
    });

    it('is the first item of the compact menu in a child table, and sends the parent with the new rows', async () => {
        const el = await mount(INLINE, {
            parent: { link: 'Nest_Accounts_Records', id: '001000000000001AAA', name: 'Casco Bay Marine', level: 2 }
        });
        const items = [...el.shadowRoot.querySelectorAll('lightning-menu-item')];
        expect(items[0].label).toBe('New');
        $(el, 'lightning-button-menu.rh-actions-menu').dispatchEvent(
            new CustomEvent('select', { detail: { value: 'new' } })
        );
        await settle();
        await typeIn(el, 'rh-new-1', 'Name', 'Casco Bay Marine, 6 crates');
        createRows.mockResolvedValue({ rows: [], rejectedFields: [], strippedFields: [] });
        tableOf(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        expect(createRows.mock.calls[0][0]).toMatchObject({
            parentLink: 'Nest_Accounts_Records',
            parentId: '001000000000001AAA',
            recordId: null
        });
    });
});
