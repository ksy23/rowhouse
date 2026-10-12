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
        field: 'Shipper__c',
        label: 'Shipper',
        type: 'reference',
        editable: true,
        sortable: true,
        referenceTo: ['Account']
    },
    { field: 'OwnerId', label: 'Owner', type: 'owner', editable: true, sortable: true, referenceTo: ['Group', 'User'] },
    {
        field: 'Mode__c',
        label: 'Mode',
        type: 'picklist',
        editable: true,
        sortable: true,
        options: ['Truckload', 'LTL', 'Parcel'].map(v => ({ value: v, label: v }))
    },
    {
        field: 'Equipment__c',
        label: 'Equipment',
        type: 'picklist',
        editable: true,
        sortable: true,
        dependentOn: 'Mode__c',
        options: [
            { value: 'Dry Van', label: 'Dry Van', validFor: ['Truckload'] },
            { value: 'Reefer', label: 'Reefer', validFor: ['Truckload'] },
            { value: 'Pallet', label: 'Pallet', validFor: ['LTL'] },
            { value: 'Crate', label: 'Crate', validFor: ['LTL'] }
        ]
    },
    {
        field: 'Handling__c',
        label: 'Handling',
        type: 'multipicklist',
        editable: true,
        sortable: true,
        options: ['Fragile', 'Liftgate', 'Inside Delivery'].map(v => ({ value: v, label: v }))
    }
];
const ROWS = [
    {
        Id: 'a01000000000001AAA',
        Name: 'Dry van load, Houlton',
        Shipper__c: ACC2,
        OwnerId: USER,
        Mode__c: 'Truckload',
        Equipment__c: 'Dry Van',
        Handling__c: 'Fragile;Liftgate;Inside Delivery'
    },
    {
        Id: 'a01000000000002AAA',
        Name: 'Reefer on LTL, Calais',
        Shipper__c: ACC1,
        OwnerId: QUEUE,
        Mode__c: 'LTL',
        Equipment__c: 'Reefer',
        Handling__c: 'Liftgate'
    },
    {
        Id: 'a01000000000003AAA',
        Name: 'Parcel drop, Eastport',
        Shipper__c: null,
        OwnerId: USER,
        Mode__c: 'Parcel',
        Equipment__c: null,
        Handling__c: null
    }
];
const NAMES = {
    [ACC1]: 'Wachusett Paper',
    [ACC2]: 'Androscoggin Pulp',
    [USER]: 'Hannah Pelletier',
    [QUEUE]: 'Bangor Dispatch'
};

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
        el.config = { columns: COLUMNS, rows: ROWS, refNames: NAMES, configName: 'Consignments' };
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
        const link = cell(0, 'Shipper__c').querySelector('a');
        expect(link.textContent).toBe('Androscoggin Pulp');
        expect(link.getAttribute('href')).toBe(`/lightning/r/${ACC2}/view`);
        // As a list view's links do: Lightning opens the record; Cmd or Ctrl opens a tab (gridTable.links.test.js).
        expect(link.getAttribute('target')).toBeNull();
        expect(link.dataset.recordId).toBe(ACC2);
    });

    it('shows a queue owner by name, without a link', () => {
        expect(cell(1, 'OwnerId').querySelector('a')).toBeNull();
        expect(cell(1, 'OwnerId').textContent).toContain('Bangor Dispatch');
        expect(cell(0, 'OwnerId').querySelector('a').textContent).toBe('Hannah Pelletier');
    });

    it('edits a lookup with the lookup editor, which searches this grid and column', async () => {
        await edit(0, 'Shipper__c');
        const editor = el.shadowRoot.querySelector('c-cell-lookup[data-editor]');
        expect(editor.configName).toBe('Consignments');
        expect(editor.field).toBe('Shipper__c');
        expect(editor.valueLabel).toBe('Androscoggin Pulp');
        // The box is the cell's width; the matches hang below it.
        expect(editor.closest('section').classList).toContain('rh-edit-popover');
        expect(editor.dropdownAlign).toBe('left');
        editor.dispatchEvent(new CustomEvent('commit', { detail: { value: ACC1, label: 'Wachusett Paper' } }));
        await flush();
        expect(change.mock.calls[0][0].detail).toEqual(
            expect.objectContaining({ field: 'Shipper__c', value: ACC1, valueLabel: 'Wachusett Paper' })
        );
    });

    it('hands the editor a lookup filter and the New targets, and passes a New on with its cell', async () => {
        el.config = {
            columns: COLUMNS.map(c =>
                c.field === 'Shipper__c'
                    ? {
                          ...c,
                          filteredLookup: true,
                          fieldApiName: 'Shipper__c',
                          newTargets: [{ object: 'Account', label: 'Account' }]
                      }
                    : c
            ),
            rows: ROWS,
            refNames: NAMES,
            configName: 'Consignments',
            objectApiName: 'Consignment__c'
        };
        await flush();
        await edit(0, 'Shipper__c');
        const editor = el.shadowRoot.querySelector('c-cell-lookup[data-editor]');
        expect(editor.filtered).toBe(true);
        expect(editor.fieldApiName).toBe('Shipper__c');
        expect(editor.objectApiName).toBe('Consignment__c');
        expect(editor.recordId).toBe(ROWS[0].Id);
        expect(editor.newTargets).toEqual([{ object: 'Account', label: 'Account' }]);
        const asked = jest.fn();
        el.addEventListener('newrecord', asked);
        editor.dispatchEvent(
            new CustomEvent('newrecord', { detail: { object: 'Account', label: 'Account', term: 'Kennebec' } })
        );
        await flush();
        expect(asked.mock.calls[0][0].detail).toEqual({
            recordId: ROWS[0].Id,
            field: 'Shipper__c',
            object: 'Account',
            objectLabel: 'Account',
            term: 'Kennebec'
        });
        expect(el.shadowRoot.querySelector('c-cell-lookup[data-editor]')).toBeNull(); // the editor closed
    });

    it('edits an owner with the same editor', async () => {
        await edit(1, 'OwnerId');
        expect(el.shadowRoot.querySelector('c-cell-lookup[data-editor]').valueLabel).toBe('Bangor Dispatch');
    });

    it('sorts a lookup column by the name shown, blanks last', async () => {
        el.shadowRoot.querySelector('th[data-field="Shipper__c"] .slds-th__action').click();
        await flush();
        const order = [...el.shadowRoot.querySelectorAll('tbody tr[data-row-id]')].map(tr => tr.dataset.rowId);
        expect(order).toEqual([ROWS[0].Id, ROWS[1].Id, ROWS[2].Id]); // Androscoggin, Wachusett, blank
    });

    it('copies a lookup as its name', async () => {
        cell(0, 'Shipper__c').focus();
        await flush();
        cell(0, 'Shipper__c').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, composed: true, cancelable: true })
        );
        const setData = jest.fn();
        const copy = new CustomEvent('copy', { bubbles: true, composed: true, cancelable: true });
        copy.clipboardData = { setData };
        cell(0, 'Shipper__c').dispatchEvent(copy);
        expect(setData).toHaveBeenCalledWith('text/plain', 'Androscoggin Pulp');
    });

    it('pastes a name shown in the grid as that record, without asking the server', async () => {
        await paste(2, 'Shipper__c', 'wachusett paper');
        expect(changes[0].changes).toEqual([expect.objectContaining({ field: 'Shipper__c', value: ACC1 })]);
        expect(findLookupNames).not.toHaveBeenCalled();
    });

    it('asks the server for a name no row shows, and pastes the record it found', async () => {
        const ACC3 = '001000000000003AAA';
        findLookupNames.mockResolvedValueOnce({ 'casco bay marine': [{ id: ACC3, name: 'Casco Bay Marine' }] });
        const found = [];
        el.addEventListener('namesfound', e => found.push(e.detail.names));
        await paste(2, 'Shipper__c', 'Casco Bay Marine');
        await flush();
        expect(findLookupNames).toHaveBeenCalledWith({
            configName: 'Consignments',
            field: 'Shipper__c',
            names: ['Casco Bay Marine']
        });
        expect(found).toEqual([{ [ACC3]: 'Casco Bay Marine' }]);
        expect(changes[0].changes).toEqual([expect.objectContaining({ field: 'Shipper__c', value: ACC3 })]);
    });

    it('refuses a name no record has, and one two records share', async () => {
        findLookupNames.mockResolvedValueOnce({});
        await paste(2, 'Shipper__c', 'Merrimack Valley Foods');
        await flush();
        expect(changes[0].errors[0].message).toBe(
            'No record named Merrimack Valley Foods was found. Paste its record Id, or choose it with the lookup.'
        );
        findLookupNames.mockResolvedValueOnce({
            'berkshire mills': [
                { id: '001000000000004AAA', name: 'Berkshire Mills' },
                { id: '001000000000005AAA', name: 'Berkshire Mills' }
            ]
        });
        await paste(2, 'Shipper__c', 'Berkshire Mills');
        await flush();
        expect(changes[1].errors[0].message).toBe(
            'More than one record is named Berkshire Mills. Paste its record Id instead.'
        );
    });

    it('pastes as before when the server cannot be asked', async () => {
        findLookupNames.mockRejectedValueOnce({ body: { message: 'No access' } });
        await paste(2, 'Shipper__c', 'Merrimack Valley Foods');
        await flush();
        expect(changes[0].errors[0].message).toContain('No record named Merrimack Valley Foods');
    });

    it('TC-037: offers a dependent picklist only the values its controlling value allows', async () => {
        await edit(0, 'Equipment__c');
        const editor = el.shadowRoot.querySelector('c-cell-picklist[data-editor]');
        expect(editor.options.map(o => o.value)).toEqual(['Dry Van', 'Reefer']);
        expect(editor.dependentOn).toBe('Mode__c');
    });

    it('TC-039: with no valid values the dependent editor is empty and disabled', async () => {
        await edit(2, 'Equipment__c');
        const editor = el.shadowRoot.querySelector('c-cell-picklist[data-editor]');
        expect(editor.options).toEqual([]);
        expect(editor.shadowRoot.querySelector('select').disabled).toBe(true);
    });

    it('TC-038: an invalid stored pairing is shown as stored', () => {
        expect(cell(1, 'Equipment__c').textContent).toContain('Reefer');
    });

    it('editing the controlling field clears a dependent value it invalidates, in one step', async () => {
        await edit(0, 'Mode__c');
        el.shadowRoot
            .querySelector('c-cell-picklist[data-editor]')
            .dispatchEvent(new CustomEvent('commit', { detail: { value: 'LTL' } }));
        await flush();
        expect(change).not.toHaveBeenCalled();
        expect(changes).toEqual([
            {
                label: 'edit',
                errors: [],
                changes: [
                    expect.objectContaining({ field: 'Mode__c', value: 'LTL' }),
                    { recordId: ROWS[0].Id, field: 'Equipment__c', value: null, originalValue: 'Dry Van' }
                ]
            }
        ]);
    });

    it('a controlling edit that keeps the dependent value valid changes nothing else', async () => {
        await edit(1, 'Mode__c');
        el.shadowRoot
            .querySelector('c-cell-picklist[data-editor]')
            .dispatchEvent(new CustomEvent('commit', { detail: { value: 'Truckload' } }));
        await flush();
        expect(changes).toEqual([]);
        expect(change).toHaveBeenCalledTimes(1);
    });

    it('refuses a pasted dependent value its controlling value does not offer, but takes a pair', async () => {
        await paste(0, 'Equipment__c', 'Pallet');
        expect(changes[0].changes).toEqual([]);
        expect(changes[0].errors[0].message).toBe('Pallet is not offered when Mode is Truckload.');
        await paste(0, 'Mode__c', 'LTL\tPallet');
        expect(changes[1].errors).toEqual([]);
        expect(changes[1].changes.map(c => c.value)).toEqual(['LTL', 'Pallet']);
    });

    it('shows a multi-select as a comma list and edits it with the dual-listbox editor', async () => {
        expect(cell(0, 'Handling__c').textContent).toContain('Fragile, Liftgate, Inside Delivery');
        await edit(0, 'Handling__c');
        const editor = el.shadowRoot.querySelector('c-cell-multi-picklist[data-editor]');
        expect(editor.value).toBe('Fragile;Liftgate;Inside Delivery');
        expect(editor.dropdownAlign).toBe('left');
    });

    it('pastes a multi-select as shown or as stored', async () => {
        await paste(2, 'Handling__c', 'inside delivery, Fragile');
        expect(changes[0].changes[0].value).toBe('Inside Delivery;Fragile');
        await paste(2, 'Handling__c', 'Liftgate;Residential');
        expect(changes[1].errors[0].message).toContain('Residential');
    });
});
