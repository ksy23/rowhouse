/**
 * The row menu's own items, as a list view's: Edit, Delete and Change Owner,
 * before the grid's actions, each only where the server says the user may.
 * Edit opens Salesforce's form, Delete asks first, Change Owner saves at
 * once; afterwards the row is read again.
 */
import { createElement } from 'lwc';
import GridView, { ROW_EDIT, ROW_DELETE, ROW_OWNER } from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import fetchRowsById from '@salesforce/apex/GridController.fetchRowsById';
import deleteRows from '@salesforce/apex/GridController.deleteRows';
import changeOwner from '@salesforce/apex/GridController.changeOwner';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRowsById', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.deleteRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.changeOwner', () => ({ default: jest.fn() }), { virtual: true });
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
const OWNER = '005000000000077AAA';

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
const rowAction = async (el, action, recordId) => {
    table(el).dispatchEvent(new CustomEvent('rowaction', { detail: { action, recordId } }));
    await settle();
};
const edit = (el, recordId, field, value, originalValue) =>
    table(el).dispatchEvent(new CustomEvent('cellchange', { detail: { recordId, field, value, originalValue } }));

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue(page([row(1), row(2), row(3)]));
    fetchRowsById.mockImplementation(({ recordIds }) =>
        Promise.resolve(recordIds.map(id => ({ ...row(Number(id.slice(3))), Consignee__c: 'Quabbin Supply' })))
    );
    deleteRows.mockImplementation(({ recordIds }) => Promise.resolve({ deletedIds: recordIds, errors: [] }));
    changeOwner.mockImplementation(({ recordIds }) => Promise.resolve({ changedIds: recordIds, errors: [] }));
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('what each row menu offers', () => {
    it("starts with Edit, Delete and Change Owner, as a list view's does, then the grid's actions", async () => {
        const el = mount();
        await settle();
        expect(table(el).config.rowActions).toEqual([
            { name: ROW_EDIT, label: 'Edit' },
            { name: ROW_DELETE, label: 'Delete' },
            { name: ROW_OWNER, label: 'Change Owner' },
            { name: 'Log_Call', label: 'Log a call' }
        ]);
    });

    it('offers each only where the server says this user may', async () => {
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, canEditRecords: false, allowMassDelete: false },
            diagnostics: false
        });
        const el = mount();
        await settle();
        expect(table(el).config.rowActions.map(a => a.name)).toEqual([ROW_OWNER, 'Log_Call']);
    });

    it('has no menu at all in a grid where the user may do none of them and there are no actions', async () => {
        getGridConfig.mockResolvedValue({
            definition: {
                ...DEFINITION,
                canEditRecords: false,
                allowMassDelete: false,
                canChangeOwner: false,
                actions: []
            },
            diagnostics: false
        });
        const el = mount();
        await settle();
        expect(table(el).config.rowActions).toEqual([]);
    });
});

describe('Edit', () => {
    it("opens Salesforce's edit form for the row's record, named in the heading", async () => {
        const el = mount();
        await settle();
        await rowAction(el, ROW_EDIT, row(2).Id);
        const form = $(el, 'c-grid-edit-record');
        expect(form).not.toBeNull();
        expect(form.recordId).toBe(row(2).Id);
        expect(form.objectApiName).toBe('Consignment__c');
        expect(form.recordName).toBe('Penobscot Paper, load 2');
    });

    it('reads the row again once Salesforce has saved it, and says so', async () => {
        const el = mount();
        await settle();
        await rowAction(el, ROW_EDIT, row(2).Id);
        $(el, 'c-grid-edit-record').dispatchEvent(new CustomEvent('saved', { detail: { id: row(2).Id } }));
        await settle();
        expect($(el, 'c-grid-edit-record')).toBeNull();
        expect(fetchRowsById).toHaveBeenCalledWith({ configName: 'Consignments', recordIds: [row(2).Id] });
        expect(table(el).config.rows.find(r => r.Id === row(2).Id).Consignee__c).toBe('Quabbin Supply');
        expect(toasts).toEqual([
            expect.objectContaining({
                title: 'Saved',
                message: '"Penobscot Paper, load 2" was saved.',
                variant: 'success'
            })
        ]);
    });

    it('closes without reading anything when cancelled', async () => {
        const el = mount();
        await settle();
        await rowAction(el, ROW_EDIT, row(2).Id);
        $(el, 'c-grid-edit-record').dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect($(el, 'c-grid-edit-record')).toBeNull();
        expect(fetchRowsById).not.toHaveBeenCalled();
    });

    it("waits for the row's unsaved changes to be saved or cancelled", async () => {
        const el = mount();
        await settle();
        edit(el, row(2).Id, 'Consignee__c', 'Casco Bay Marine', 'Wachusett Paper');
        await settle();
        await rowAction(el, ROW_EDIT, row(2).Id);
        expect($(el, 'c-grid-edit-record')).toBeNull();
        expect(toasts).toEqual([
            expect.objectContaining({
                title: 'Unsaved changes',
                message: 'Save or cancel the changes to this row, then edit it.',
                variant: 'warning'
            })
        ]);
    });
});

describe('Delete', () => {
    it('asks in the delete dialog, naming that row only, then deletes it', async () => {
        const el = mount();
        await settle();
        await rowAction(el, ROW_DELETE, row(3).Id);
        const ask = $(el, 'c-grid-delete-dialog');
        expect(ask.count).toBe(1);
        expect(ask.names).toEqual(['Penobscot Paper, load 3']);
        ask.dispatchEvent(new CustomEvent('confirm'));
        await settle();
        expect(deleteRows).toHaveBeenCalledWith({ configName: 'Consignments', recordIds: [row(3).Id] });
        expect(table(el).config.rows.map(r => r.Id)).toEqual([row(1).Id, row(2).Id]);
    });

    it('leaves the selection alone when the row deleted was not selected', async () => {
        const el = mount();
        await settle();
        table(el).dispatchEvent(new CustomEvent('selectionchange', { detail: { selectedIds: [row(1).Id] } }));
        await settle();
        await rowAction(el, ROW_DELETE, row(3).Id);
        $(el, 'c-grid-delete-dialog').dispatchEvent(new CustomEvent('confirm'));
        await settle();
        expect($(el, '.rh-selection-count')).not.toBeNull();
    });

    it('is not offered, and does nothing, in a grid that does not allow deleting', async () => {
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, allowMassDelete: false }, diagnostics: false });
        const el = mount();
        await settle();
        await rowAction(el, ROW_DELETE, row(3).Id);
        expect($(el, 'c-grid-delete-dialog')).toBeNull();
    });
});

describe('Change Owner', () => {
    it('asks for the new owner, saves at once, reads the row again and says so', async () => {
        const el = mount();
        await settle();
        await rowAction(el, ROW_OWNER, row(1).Id);
        const ask = $(el, 'c-grid-change-owner');
        expect(ask.recordName).toBe('Penobscot Paper, load 1');
        expect(ask.configName).toBe('Consignments');
        ask.dispatchEvent(new CustomEvent('confirm', { detail: { ownerId: OWNER, ownerName: 'Nora Pelletier' } }));
        await settle();
        expect(changeOwner).toHaveBeenCalledWith({
            configName: 'Consignments',
            recordIds: [row(1).Id],
            ownerId: OWNER
        });
        expect($(el, 'c-grid-change-owner')).toBeNull();
        expect(fetchRowsById).toHaveBeenCalledWith({ configName: 'Consignments', recordIds: [row(1).Id] });
        expect(toasts).toEqual([
            expect.objectContaining({
                title: 'Owner changed',
                message: 'Penobscot Paper, load 1 is now owned by Nora Pelletier.',
                variant: 'success'
            })
        ]);
    });

    it("keeps the dialog open with Salesforce's reason when the record cannot change owner", async () => {
        changeOwner.mockResolvedValue({
            changedIds: [],
            errors: [{ recordId: row(1).Id, fieldName: null, message: 'insufficient access rights on object id' }]
        });
        const el = mount();
        await settle();
        await rowAction(el, ROW_OWNER, row(1).Id);
        $(el, 'c-grid-change-owner').dispatchEvent(
            new CustomEvent('confirm', { detail: { ownerId: OWNER, ownerName: 'Nora Pelletier' } })
        );
        await settle();
        const ask = $(el, 'c-grid-change-owner');
        expect(ask).not.toBeNull();
        expect(ask.busy).toBe(false);
        expect(ask.error).toBe('insufficient access rights on object id');
        expect(fetchRowsById).not.toHaveBeenCalled();
    });

    it("keeps the dialog open with the server's refusal", async () => {
        changeOwner.mockRejectedValue({ body: { message: 'You cannot change the owner of records in this grid.' } });
        const el = mount();
        await settle();
        await rowAction(el, ROW_OWNER, row(1).Id);
        $(el, 'c-grid-change-owner').dispatchEvent(
            new CustomEvent('confirm', { detail: { ownerId: OWNER, ownerName: 'Nora Pelletier' } })
        );
        await settle();
        expect($(el, 'c-grid-change-owner').error).toBe('You cannot change the owner of records in this grid.');
    });

    it("waits for the row's unsaved changes to be saved or cancelled", async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Consignee__c', 'Casco Bay Marine', 'Wachusett Paper');
        await settle();
        await rowAction(el, ROW_OWNER, row(1).Id);
        expect($(el, 'c-grid-change-owner')).toBeNull();
        expect(toasts[0].message).toBe('Save or cancel the changes to this row, then change its owner.');
    });
});
