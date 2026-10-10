/**
 * Lookups, owners, dependent and multi-select picklists in the table.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

import findLookupNames from '@salesforce/apex/GridController.findLookupNames';

jest.mock('@salesforce/apex/GridController.searchLookup', () => ({ default: jest.fn(() => Promise.resolve([])) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.findLookupNames', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const ACC1 = '001000000000001AAA';
const ACC2 = '001000000000002AAA';
const USER = '005000000000001AAA';
const QUEUE = '00G000000000001AAA';

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
    {
        field: 'Lookup_Field__c',
        label: 'Account',
        type: 'reference',
        editable: true,
        sortable: true,
        referenceTo: ['Account']
    },
    { field: 'OwnerId', label: 'Owner', type: 'owner', editable: true, sortable: true, referenceTo: ['Group', 'User'] },
    {
        field: 'Controlling_Picklist__c',
        label: 'Category',
        type: 'picklist',
        editable: true,
        sortable: true,
        options: ['Hardware', 'Software', 'Services'].map(v => ({ value: v, label: v }))
    },
    {
        field: 'Dependent_Picklist__c',
        label: 'Item',
        type: 'picklist',
        editable: true,
        sortable: true,
        dependentOn: 'Controlling_Picklist__c',
        options: [
            { value: 'Keyboard', label: 'Keyboard', validFor: ['Hardware'] },
            { value: 'Monitor', label: 'Monitor', validFor: ['Hardware'] },
            { value: 'Licence', label: 'Licence', validFor: ['Software'] },
            { value: 'Subscription', label: 'Subscription', validFor: ['Software'] }
        ]
    },
    {
        field: 'Multi_Picklist__c',
        label: 'Colors',
        type: 'multipicklist',
        editable: true,
        sortable: true,
        options: ['Red', 'Green', 'Blue'].map(v => ({ value: v, label: v }))
    }
];
const ROWS = [
    {
        Id: 'a01000000000001AAA',
        Name: 'TC-037',
        Lookup_Field__c: ACC2,
        OwnerId: USER,
        Controlling_Picklist__c: 'Hardware',
        Dependent_Picklist__c: 'Keyboard',
        Multi_Picklist__c: 'Red;Green;Blue'
    },
    {
        Id: 'a01000000000002AAA',
        Name: 'TC-038',
        Lookup_Field__c: ACC1,
        OwnerId: QUEUE,
        Controlling_Picklist__c: 'Software',
        Dependent_Picklist__c: 'Monitor',
        Multi_Picklist__c: 'Green'
    },
    {
        Id: 'a01000000000003AAA',
        Name: 'TC-039',
        Lookup_Field__c: null,
        OwnerId: USER,
        Controlling_Picklist__c: 'Services',
        Dependent_Picklist__c: null,
        Multi_Picklist__c: null
    }
];
const NAMES = { [ACC1]: 'Zeta Corp', [ACC2]: 'Alpha Corp', [USER]: 'Rowhouse Full', [QUEUE]: 'Support Queue' };

describe('lookups and picklist dependencies', () => {
    let el;
    let change;
    let changes;
    const cell = (i, field) => el.shadowRoot.querySelector(`td[data-row-id="${ROWS[i].Id}"][data-field="${field}"]`);
    const edit = async (i, field) => {
        cell(i, field).querySelector('button').click();
        await flush();
    };
    const paste = async (i, field, text) => {
        cell(i, field).focus();
        await flush();
        const event = new CustomEvent('paste', { bubbles: true, composed: true, cancelable: true });
        event.clipboardData = { getData: () => text };
        cell(i, field).dispatchEvent(event);
        await flush();
    };

    beforeEach(async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns: COLUMNS, rows: ROWS, refNames: NAMES, configName: 'Test_Records' };
        change = jest.fn();
        changes = [];
        el.addEventListener('cellchange', change);
        el.addEventListener('cellschange', e => changes.push(e.detail));
        document.body.appendChild(el);
        await flush();
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        jest.clearAllMocks();
    });

    it('shows a lookup as its record name, linked to the record in the same tab', () => {
        const link = cell(0, 'Lookup_Field__c').querySelector('a');
        expect(link.textContent).toBe('Alpha Corp');
        expect(link.getAttribute('href')).toBe(`/lightning/r/${ACC2}/view`);
        // As a list view's links do: Lightning opens the record; Cmd or Ctrl opens a tab (gridTable.links.test.js).
        expect(link.getAttribute('target')).toBeNull();
        expect(link.dataset.recordId).toBe(ACC2);
    });

    it('shows a queue owner by name, without a link', () => {
        expect(cell(1, 'OwnerId').querySelector('a')).toBeNull();
        expect(cell(1, 'OwnerId').textContent).toContain('Support Queue');
        expect(cell(0, 'OwnerId').querySelector('a').textContent).toBe('Rowhouse Full');
    });

    it('edits a lookup with the lookup editor, which searches this grid and column', async () => {
        await edit(0, 'Lookup_Field__c');
        const editor = el.shadowRoot.querySelector('c-cell-lookup[data-editor]');
        expect(editor.configName).toBe('Test_Records');
        expect(editor.field).toBe('Lookup_Field__c');
        expect(editor.valueLabel).toBe('Alpha Corp');
        // The box is the cell's width; the matches hang below it.
        expect(editor.closest('section').classList).toContain('rh-edit-popover');
        expect(editor.dropdownAlign).toBe('left');
        editor.dispatchEvent(new CustomEvent('commit', { detail: { value: ACC1, label: 'Zeta Corp' } }));
        await flush();
        expect(change.mock.calls[0][0].detail).toEqual(
            expect.objectContaining({ field: 'Lookup_Field__c', value: ACC1, valueLabel: 'Zeta Corp' })
        );
    });

    it('hands the editor a lookup filter and the New targets, and passes a New on with its cell', async () => {
        el.config = {
            columns: COLUMNS.map(c =>
                c.field === 'Lookup_Field__c'
                    ? {
                          ...c,
                          filteredLookup: true,
                          fieldApiName: 'Lookup_Field__c',
                          newTargets: [{ object: 'Account', label: 'Account' }]
                      }
                    : c
            ),
            rows: ROWS,
            refNames: NAMES,
            configName: 'Test_Records',
            objectApiName: 'Rowhouse_Test_Record__c'
        };
        await flush();
        await edit(0, 'Lookup_Field__c');
        const editor = el.shadowRoot.querySelector('c-cell-lookup[data-editor]');
        expect(editor.filtered).toBe(true);
        expect(editor.fieldApiName).toBe('Lookup_Field__c');
        expect(editor.objectApiName).toBe('Rowhouse_Test_Record__c');
        expect(editor.recordId).toBe(ROWS[0].Id);
        expect(editor.newTargets).toEqual([{ object: 'Account', label: 'Account' }]);
        const asked = jest.fn();
        el.addEventListener('newrecord', asked);
        editor.dispatchEvent(
            new CustomEvent('newrecord', { detail: { object: 'Account', label: 'Account', term: 'Ze' } })
        );
        await flush();
        expect(asked.mock.calls[0][0].detail).toEqual({
            recordId: ROWS[0].Id,
            field: 'Lookup_Field__c',
            object: 'Account',
            objectLabel: 'Account',
            term: 'Ze'
        });
        expect(el.shadowRoot.querySelector('c-cell-lookup[data-editor]')).toBeNull(); // the editor closed
    });

    it('edits an owner with the same editor', async () => {
        await edit(1, 'OwnerId');
        expect(el.shadowRoot.querySelector('c-cell-lookup[data-editor]').valueLabel).toBe('Support Queue');
    });

    it('sorts a lookup column by the name shown, blanks last', async () => {
        el.shadowRoot.querySelector('th[data-field="Lookup_Field__c"] .slds-th__action').click();
        await flush();
        const order = [...el.shadowRoot.querySelectorAll('tbody tr[data-row-id]')].map(tr => tr.dataset.rowId);
        expect(order).toEqual([ROWS[0].Id, ROWS[1].Id, ROWS[2].Id]); // Alpha, Zeta, blank
    });

    it('copies a lookup as its name', async () => {
        cell(0, 'Lookup_Field__c').focus();
        await flush();
        cell(0, 'Lookup_Field__c').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, composed: true, cancelable: true })
        );
        const setData = jest.fn();
        const copy = new CustomEvent('copy', { bubbles: true, composed: true, cancelable: true });
        copy.clipboardData = { setData };
        cell(0, 'Lookup_Field__c').dispatchEvent(copy);
        expect(setData).toHaveBeenCalledWith('text/plain', 'Alpha Corp');
    });

    it('pastes a name shown in the grid as that record, without asking the server', async () => {
        await paste(2, 'Lookup_Field__c', 'zeta corp');
        expect(changes[0].changes).toEqual([expect.objectContaining({ field: 'Lookup_Field__c', value: ACC1 })]);
        expect(findLookupNames).not.toHaveBeenCalled();
    });

    it('asks the server for a name no row shows, and pastes the record it found', async () => {
        const ACC3 = '001000000000003AAA';
        findLookupNames.mockResolvedValueOnce({ 'edge communications': [{ id: ACC3, name: 'Edge Communications' }] });
        const found = [];
        el.addEventListener('namesfound', e => found.push(e.detail.names));
        await paste(2, 'Lookup_Field__c', 'Edge Communications');
        await flush();
        expect(findLookupNames).toHaveBeenCalledWith({
            configName: 'Test_Records',
            field: 'Lookup_Field__c',
            names: ['Edge Communications']
        });
        expect(found).toEqual([{ [ACC3]: 'Edge Communications' }]);
        expect(changes[0].changes).toEqual([expect.objectContaining({ field: 'Lookup_Field__c', value: ACC3 })]);
    });

    it('refuses a name no record has, and one two records share', async () => {
        findLookupNames.mockResolvedValueOnce({});
        await paste(2, 'Lookup_Field__c', 'Nobody Inc');
        await flush();
        expect(changes[0].errors[0].message).toBe(
            'No record named Nobody Inc was found. Paste its record Id, or choose it with the lookup.'
        );
        findLookupNames.mockResolvedValueOnce({
            'twin co': [
                { id: '001000000000004AAA', name: 'Twin Co' },
                { id: '001000000000005AAA', name: 'Twin Co' }
            ]
        });
        await paste(2, 'Lookup_Field__c', 'Twin Co');
        await flush();
        expect(changes[1].errors[0].message).toBe(
            'More than one record is named Twin Co. Paste its record Id instead.'
        );
    });

    it('pastes as before when the server cannot be asked', async () => {
        findLookupNames.mockRejectedValueOnce({ body: { message: 'No access' } });
        await paste(2, 'Lookup_Field__c', 'Nobody Inc');
        await flush();
        expect(changes[0].errors[0].message).toContain('No record named Nobody Inc');
    });

    it('TC-037: offers a dependent picklist only the values its controlling value allows', async () => {
        await edit(0, 'Dependent_Picklist__c');
        const editor = el.shadowRoot.querySelector('c-cell-picklist[data-editor]');
        expect(editor.options.map(o => o.value)).toEqual(['Keyboard', 'Monitor']);
        expect(editor.dependentOn).toBe('Controlling_Picklist__c');
    });

    it('TC-039: with no valid values the dependent editor is empty and disabled', async () => {
        await edit(2, 'Dependent_Picklist__c');
        const editor = el.shadowRoot.querySelector('c-cell-picklist[data-editor]');
        expect(editor.options).toEqual([]);
        expect(editor.shadowRoot.querySelector('select').disabled).toBe(true);
    });

    it('TC-038: an invalid stored pairing is shown as stored', () => {
        expect(cell(1, 'Dependent_Picklist__c').textContent).toContain('Monitor');
    });

    it('editing the controlling field clears a dependent value it invalidates, in one step', async () => {
        await edit(0, 'Controlling_Picklist__c');
        el.shadowRoot
            .querySelector('c-cell-picklist[data-editor]')
            .dispatchEvent(new CustomEvent('commit', { detail: { value: 'Software' } }));
        await flush();
        expect(change).not.toHaveBeenCalled();
        expect(changes).toEqual([
            {
                label: 'edit',
                errors: [],
                changes: [
                    expect.objectContaining({ field: 'Controlling_Picklist__c', value: 'Software' }),
                    { recordId: ROWS[0].Id, field: 'Dependent_Picklist__c', value: null, originalValue: 'Keyboard' }
                ]
            }
        ]);
    });

    it('a controlling edit that keeps the dependent value valid changes nothing else', async () => {
        await edit(1, 'Controlling_Picklist__c');
        el.shadowRoot
            .querySelector('c-cell-picklist[data-editor]')
            .dispatchEvent(new CustomEvent('commit', { detail: { value: 'Hardware' } }));
        await flush();
        expect(changes).toEqual([]);
        expect(change).toHaveBeenCalledTimes(1);
    });

    it('refuses a pasted dependent value its controlling value does not offer, but takes a pair', async () => {
        await paste(0, 'Dependent_Picklist__c', 'Licence');
        expect(changes[0].changes).toEqual([]);
        expect(changes[0].errors[0].message).toBe('Licence is not offered when Category is Hardware.');
        await paste(0, 'Controlling_Picklist__c', 'Software\tLicence');
        expect(changes[1].errors).toEqual([]);
        expect(changes[1].changes.map(c => c.value)).toEqual(['Software', 'Licence']);
    });

    it('shows a multi-select as a comma list and edits it with the dual-listbox editor', async () => {
        expect(cell(0, 'Multi_Picklist__c').textContent).toContain('Red, Green, Blue');
        await edit(0, 'Multi_Picklist__c');
        const editor = el.shadowRoot.querySelector('c-cell-multi-picklist[data-editor]');
        expect(editor.value).toBe('Red;Green;Blue');
        expect(editor.dropdownAlign).toBe('left');
    });

    it('pastes a multi-select as shown or as stored', async () => {
        await paste(2, 'Multi_Picklist__c', 'blue, Red');
        expect(changes[0].changes[0].value).toBe('Blue;Red');
        await paste(2, 'Multi_Picklist__c', 'Green;Purple');
        expect(changes[1].errors[0].message).toContain('Purple');
    });
});
