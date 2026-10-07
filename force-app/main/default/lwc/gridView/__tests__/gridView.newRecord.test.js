/**
 * A lookup's New item: the grid opens the record form, and the record
 * saved goes in the cell as an unsaved change, with its name.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import lookupName from '@salesforce/apex/GridController.lookupName';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.lookupName', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});

const DEFINITION = {
    name: 'Test_Records',
    label: 'Test Records',
    objectApiName: 'Rowhouse_Test_Record__c',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true },
        {
            field: 'Lookup_Field__c',
            label: 'Related Account',
            type: 'reference',
            editable: true,
            referenceTo: ['Account'],
            newTargets: [{ object: 'Account', label: 'Account' }]
        }
    ]
};
const ROW = { Id: 'a00000000000000001', Name: 'Row 1', Lookup_Field__c: null };
const NEW_ID = '001000000000009AAA';
const settle = async () => {
    for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    jest.useFakeTimers();
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
    jest.useRealTimers();
});

describe("a lookup's New item", () => {
    const open = async () => {
        const el = createElement('c-grid-view', { is: GridView });
        el.configName = 'Test_Records';
        document.body.appendChild(el);
        await settle();
        $(el, 'c-grid-table').dispatchEvent(
            new CustomEvent('newrecord', {
                detail: {
                    recordId: ROW.Id,
                    field: 'Lookup_Field__c',
                    object: 'Account',
                    objectLabel: 'Account',
                    term: 'Acm'
                }
            })
        );
        await settle();
        return el;
    };

    it('opens the record form for the object, naming the column', async () => {
        const el = await open();
        const dialog = $(el, 'c-grid-new-record');
        expect(dialog.objectApiName).toBe('Account');
        expect(dialog.objectLabel).toBe('Account');
        expect(dialog.fieldLabel).toBe('Related Account');
        expect($(el, 'c-grid-table').config.objectApiName).toBe('Rowhouse_Test_Record__c');
    });

    it('puts the saved record in the cell as an unsaved change, with its name', async () => {
        lookupName.mockResolvedValue('Acme New');
        const el = await open();
        $(el, 'c-grid-new-record').dispatchEvent(new CustomEvent('created', { detail: { id: NEW_ID } }));
        await settle();
        expect($(el, 'c-grid-new-record')).toBeNull();
        expect(lookupName).toHaveBeenCalledWith({
            configName: 'Test_Records',
            field: 'Lookup_Field__c',
            recordId: NEW_ID
        });
        const config = $(el, 'c-grid-table').config;
        expect(config.drafts).toEqual({ [ROW.Id]: { Lookup_Field__c: NEW_ID } });
        expect(config.refNames[NEW_ID]).toBe('Acme New');
        expect(config.history.undoLabel).toBe('Undo edit');
        expect($(el, '.rh-live').textContent).toBe(
            'Account Acme New created and put in Related Account. Save to keep the change.'
        );
    });

    it('changes nothing when cancelled', async () => {
        const el = await open();
        $(el, 'c-grid-new-record').dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect($(el, 'c-grid-new-record')).toBeNull();
        expect($(el, 'c-grid-table').config.drafts).toEqual({});
    });
});
