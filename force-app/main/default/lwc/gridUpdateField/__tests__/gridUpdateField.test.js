/**
 * The mass update dialog: which fields it offers, how it reads each kind
 * of value, what it refuses, and the keyboard. massChanges(), the rows a value
 * reaches, is tested first.
 */
import { createElement } from 'lwc';
import GridUpdateField, { massChanges, REQUIRED_MESSAGE } from 'c/gridUpdateField';

jest.mock('@salesforce/apex/GridController.searchLookup', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const CONTROLLING = {
    field: 'Mode__c',
    label: 'Mode',
    type: 'picklist',
    editable: true,
    options: [
        { value: 'Truckload', label: 'Truckload' },
        { value: 'LTL', label: 'LTL' }
    ]
};
const DEPENDENT = {
    field: 'Equipment__c',
    label: 'Equipment',
    type: 'picklist',
    editable: true,
    dependentOn: 'Mode__c',
    options: [
        { value: 'Dry Van', label: 'Dry Van', validFor: ['Truckload'] },
        { value: 'Pallet', label: 'Pallet', validFor: ['LTL'] }
    ]
};
const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, required: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', editable: true, scale: 2 },
    { field: 'Ship_Date__c', label: 'Ship Date', type: 'date', editable: true },
    { field: 'Delivered__c', label: 'Delivered', type: 'checkbox', editable: true },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        editable: true,
        options: [
            { value: 'Standard', label: 'Standard' },
            { value: 'Express', label: 'Express' }
        ]
    },
    {
        field: 'Handling__c',
        label: 'Handling',
        type: 'multipicklist',
        editable: true,
        options: [
            { value: 'Fragile', label: 'Fragile' },
            { value: 'Liftgate', label: 'Liftgate' }
        ]
    },
    { field: 'Account__c', label: 'Account', type: 'reference', editable: true },
    { field: 'Pallet_Positions__c', label: 'Pallet Positions', type: 'number', editable: false },
    CONTROLLING,
    DEPENDENT
];
// The kinds that came with the new editors, kept apart so the counts above stay as they were.
const D46_COLUMNS = [
    { field: 'Picked_Up__c', label: 'Picked Up', type: 'datetime', editable: true },
    { field: 'Pickup_Time__c', label: 'Pickup Time', type: 'time', editable: true },
    { field: 'Delivery_Notes__c', label: 'Delivery Notes', type: 'textarea', editable: true, length: 32768 },
    {
        field: 'Handling_Instructions__c',
        label: 'Handling Instructions',
        type: 'textarea',
        editable: true,
        required: true,
        length: 255
    }
];
// Some versions of Intl put a narrow space before AM and PM; read it as a space.
const words = text => String(text).replace(/\s/g, ' ');

describe('massChanges', () => {
    const rows = [
        { Id: 'a1', Mode__c: 'Truckload', Equipment__c: 'Dry Van', Freight_Charge__c: '5' },
        { Id: 'a2', Mode__c: 'LTL', Equipment__c: 'Pallet', Freight_Charge__c: '7' },
        { Id: 'a3', Mode__c: null, Equipment__c: null, Freight_Charge__c: null }
    ];
    const rowById = new Map(rows.map(r => [r.Id, r]));

    it('changes the field on every selected row that is loaded, with its stored value as the original', () => {
        const out = massChanges({
            ids: ['a1', 'a3', 'gone'],
            column: COLUMNS[1],
            value: '10.00',
            rowById,
            drafts: {},
            columns: COLUMNS
        });
        expect(out.changes).toEqual([
            { recordId: 'a1', field: 'Freight_Charge__c', value: '10.00', originalValue: '5' },
            { recordId: 'a3', field: 'Freight_Charge__c', value: '10.00', originalValue: null }
        ]);
        expect(out.errors).toEqual([]);
    });

    it('refuses a dependent value on rows whose controlling value does not offer it, reading unsaved edits', () => {
        const drafts = { a2: { Mode__c: 'Truckload' } }; // a2 is Truckload now, unsaved
        const out = massChanges({
            ids: ['a1', 'a2', 'a3'],
            column: DEPENDENT,
            value: 'Dry Van',
            rowById,
            drafts,
            columns: COLUMNS
        });
        expect(out.changes.map(c => c.recordId)).toEqual(['a1', 'a2']);
        expect(out.errors).toEqual([
            { recordId: 'a3', field: 'Equipment__c', message: 'Dry Van is not offered when Mode is blank.' }
        ]);
    });

    it('clears dependent values a new controlling value no longer allows, in the same changes', () => {
        const out = massChanges({
            ids: ['a1', 'a2'],
            column: CONTROLLING,
            value: 'Truckload',
            rowById,
            drafts: {},
            columns: COLUMNS
        });
        // a1 is already Truckload: nothing to clear. a2's Pallet is not offered for Truckload.
        expect(out.cleared).toEqual([{ recordId: 'a2', field: 'Equipment__c', value: null, originalValue: 'Pallet' }]);
        expect(out.changes).toHaveLength(3);
    });
});

describe('the dialog', () => {
    let el;
    let applied;
    let cancelled;
    const $ = selector => el.shadowRoot.querySelector(selector);
    const mount = async props => {
        el = createElement('c-grid-update-field', { is: GridUpdateField });
        Object.assign(el, { columns: COLUMNS, count: 3, configName: 'Consignments', ...props });
        applied = [];
        cancelled = 0;
        el.addEventListener('apply', e => applied.push(e.detail));
        el.addEventListener('cancel', () => {
            cancelled++;
        });
        document.body.appendChild(el);
        await flush();
    };
    const choose = async field => {
        $('.rh-mass-field').dispatchEvent(new CustomEvent('change', { detail: { value: field } }));
        await flush();
    };
    const enter = async (value, target = '.rh-mass-value') => {
        $(target).dispatchEvent(new CustomEvent('change', { detail: { value } }));
        await flush();
    };
    const apply = async () => {
        $('.rh-mass-apply').click();
        await flush();
    };
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('is a labelled modal dialog that says how many rows it changes', async () => {
        await mount();
        const dialog = $('section[role="dialog"]');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect($('h1').textContent).toBe('Change 3 selected rows');
        expect(dialog.getAttribute('aria-labelledby')).toBe($('h1').getAttribute('id'));
    });

    describe('details', () => {
        const ROWS = [
            { Id: 'a1', Name: 'Casco Bay Marine', Service_Level__c: 'Standard', Account__c: '001000000000001AAA' },
            { Id: 'a2', Name: 'Wachusett Paper', Service_Level__c: 'Standard', Account__c: null },
            { Id: 'a3', Name: 'Quabbin Supply', Service_Level__c: null, Account__c: '001000000000001AAA' },
            { Id: 'a4', Name: 'Penobscot Paper', Service_Level__c: 'Express', Account__c: null }
        ];

        it('names the rows it changes, the first few and how many more', async () => {
            await mount({ rows: ROWS, count: 4 });
            expect($('.rh-mass-rows').textContent).toBe('Casco Bay Marine, Wachusett Paper, Quabbin Supply and 1 more');
            document.body.firstChild.remove();
            await mount({ rows: ROWS.slice(0, 2), count: 2 });
            expect($('.rh-mass-rows').textContent).toBe('Casco Bay Marine and Wachusett Paper');
            // Read with the dialog's description.
            expect($('#description, [id^="description"]').textContent).toContain(
                'Casco Bay Marine and Wachusett Paper'
            );
        });

        it('says what the chosen field holds now, the commonest first', async () => {
            await mount({ rows: ROWS, count: 4 });
            expect($('.rh-mass-current')).toBeNull(); // no field chosen yet
            await choose('Service_Level__c');
            expect($('.rh-mass-current').textContent).toBe('Currently: Standard (2), blank (1), Express (1)');
        });

        it('says so when every row holds the same', async () => {
            await mount({ rows: ROWS.slice(0, 2), count: 2 });
            await choose('Service_Level__c');
            expect($('.rh-mass-current').textContent).toBe('Currently: Standard on every row');
        });

        it("shows a lookup's current values by name", async () => {
            await mount({ rows: ROWS, count: 4, refNames: { '001000000000001AAA': 'Androscoggin Pulp' } });
            await choose('Account__c');
            expect($('.rh-mass-current').textContent).toBe('Currently: Androscoggin Pulp (2), blank (2)');
        });

        it('is tall only for a lookup or a multi-select, where a list opens inside it', async () => {
            await mount({ rows: ROWS, count: 4 });
            await choose('Freight_Charge__c');
            expect($('.rh-mass-body').classList).not.toContain('rh-mass-body_tall');
            await choose('Account__c');
            expect($('.rh-mass-body').classList).toContain('rh-mass-body_tall');
            await choose('Handling__c');
            expect($('.rh-mass-body').classList).toContain('rh-mass-body_tall');
        });

        it("hands the lookup its targets' icons", async () => {
            const columns = COLUMNS.map(c =>
                c.field === 'Account__c' ? { ...c, referenceIcons: { Account: 'standard:account' } } : c
            );
            await mount({ columns, rows: ROWS, count: 4 });
            await choose('Account__c');
            expect($('c-cell-lookup').icons).toEqual({ Account: 'standard:account' });
        });
    });

    it('offers only the editable columns, and chooses the only one for you', async () => {
        await mount();
        expect($('.rh-mass-field').options.map(o => o.value)).not.toContain('Pallet_Positions__c');
        expect($('.rh-mass-field').options).toHaveLength(9);
        expect($('.rh-mass-apply').disabled).toBe(true);
        document.body.firstChild.remove();
        await mount({ columns: [COLUMNS[1], COLUMNS[7]] });
        expect($('.rh-mass-field').value).toBe('Freight_Charge__c');
        expect($('lightning-input.rh-mass-value')).not.toBeNull();
    });

    it('reads a number as the grid reads a paste, and refuses one it cannot read', async () => {
        await mount();
        await choose('Freight_Charge__c');
        await enter('$1,234.567');
        await apply();
        expect(applied).toEqual([{ field: 'Freight_Charge__c', value: 1234.57, valueLabel: null }]);
        await enter('twelve');
        await apply();
        expect(applied).toHaveLength(1);
        expect($('.rh-mass-error').textContent).toBe('Not a number: twelve');
    });

    it('refuses to clear a required field', async () => {
        await mount();
        await choose('Name');
        expect($('.rh-mass-hint').textContent).toBe('Name is required, so it cannot be cleared.');
        await apply();
        expect(applied).toEqual([]);
        expect($('.rh-mass-error').textContent).toBe(REQUIRED_MESSAGE);
        await enter('Casco Bay Marine');
        expect($('.rh-mass-error')).toBeNull();
        await apply();
        expect(applied).toEqual([{ field: 'Name', value: 'Casco Bay Marine', valueLabel: null }]);
    });

    it('takes a date, a checkbox, a picklist and --None--, and a multi-select', async () => {
        await mount();
        await choose('Ship_Date__c');
        await enter('2026-12-31');
        await apply();
        await choose('Delivered__c');
        expect($('.rh-mass-apply').disabled).toBe(true); // Checked or Unchecked must be chosen
        await enter('false');
        await apply();
        await choose('Service_Level__c');
        expect($('.rh-mass-value').options[0]).toEqual({ label: '--None--', value: '' });
        await enter('');
        await apply();
        await choose('Handling__c');
        await enter(['Fragile', 'Liftgate']);
        await apply();
        expect(applied.map(a => a.value)).toEqual(['2026-12-31', false, null, 'Fragile;Liftgate']);
    });

    it('takes the record chosen in the lookup, with its name', async () => {
        await mount();
        await choose('Account__c');
        const lookup = $('c-cell-lookup');
        expect(lookup.mode).toBe('edit');
        expect(lookup.field).toBe('Account__c');
        expect(lookup.tabLeaves).toBe(true);
        lookup.dispatchEvent(
            new CustomEvent('commit', { detail: { value: '001000000000001AAA', label: 'Casco Bay Marine' } })
        );
        await flush();
        // The choice goes back into the search box, so leaving it with Tab keeps it.
        expect(lookup.value).toBe('001000000000001AAA');
        expect(lookup.valueLabel).toBe('Casco Bay Marine');
        await apply();
        expect(applied).toEqual([{ field: 'Account__c', value: '001000000000001AAA', valueLabel: 'Casco Bay Marine' }]);
    });

    it('explains a dependent picklist', async () => {
        await mount();
        await choose('Equipment__c');
        expect($('.rh-mass-hint').textContent).toBe(
            'Rows where Mode does not offer the value keep theirs, and are marked.'
        );
    });

    it('applies on Enter in a text box, and cancels on Escape and Cancel', async () => {
        await mount();
        await choose('Freight_Charge__c');
        await enter('5');
        $('.rh-mass-value').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })
        );
        await flush();
        expect(applied).toEqual([{ field: 'Freight_Charge__c', value: 5, valueLabel: null }]);
        $('.rh-mass-field').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
        );
        $('.rh-mass-cancel').click();
        expect(cancelled).toBe(2);
    });

    it('closes on Escape in the lookup only when its list was not open', async () => {
        await mount();
        await choose('Account__c');
        $('c-cell-lookup').dispatchEvent(new CustomEvent('cancel', { detail: { listOpen: true } }));
        expect(cancelled).toBe(0);
        $('c-cell-lookup').dispatchEvent(new CustomEvent('cancel', { detail: { listOpen: false } }));
        expect(cancelled).toBe(1);
    });

    it('keeps focus inside: each guard sends it round to the other end', async () => {
        await mount({ columns: [COLUMNS[1]] });
        const field = $('.rh-mass-field');
        field.focus = jest.fn();
        $('[data-guard="end"]').dispatchEvent(new CustomEvent('focus'));
        expect(field.focus).toHaveBeenCalled();
        $('[data-guard="start"]').dispatchEvent(new CustomEvent('focus'));
        expect(el.shadowRoot.activeElement).toBe($('.rh-mass-apply'));
    });

    describe('date/time, time and text area', () => {
        const columns = COLUMNS.concat(D46_COLUMNS);
        const keyDown = (target, key) => {
            $(target).dispatchEvent(
                new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true })
            );
        };

        it('offers a date and time picker in the user’s time zone, and applies the instant it gives', async () => {
            await mount({ columns });
            await choose('Picked_Up__c');
            const input = $('lightning-input.rh-mass-value');
            expect(input.type).toBe('datetime');
            expect(input.timezone).toBe('America/Los_Angeles');
            expect(input.label).toBe('New Picked Up');
            expect($('.rh-mass-hint').textContent).toBe('Leave it empty to clear Picked Up.');
            await enter('2026-10-01T17:30:00.000Z');
            await apply();
            await enter('');
            await apply();
            expect(applied).toEqual([
                { field: 'Picked_Up__c', value: '2026-10-01T17:30:00.000Z', valueLabel: null },
                { field: 'Picked_Up__c', value: null, valueLabel: null }
            ]);
        });

        it('offers a time picker, and applies its time as Salesforce writes a Time; empty clears it', async () => {
            await mount({ columns });
            await choose('Pickup_Time__c');
            const input = $('lightning-input.rh-mass-value');
            expect(input.type).toBe('time');
            expect(input.label).toBe('New Pickup Time');
            await enter('13:30:00.000');
            await apply();
            await enter('');
            await apply();
            expect(applied).toEqual([
                { field: 'Pickup_Time__c', value: '13:30:00.000Z', valueLabel: null },
                { field: 'Pickup_Time__c', value: null, valueLabel: null }
            ]);
        });

        it('refuses a time it cannot read', async () => {
            await mount({ columns });
            await choose('Pickup_Time__c');
            await enter('lunch');
            await apply();
            expect(applied).toEqual([]);
            expect($('.rh-mass-error').textContent).toBe('Not a time: lunch');
        });

        it('applies on Enter in the date/time and time pickers', async () => {
            await mount({ columns });
            await choose('Picked_Up__c');
            await enter('2026-10-01T17:30:00.000Z');
            keyDown('.rh-mass-value', 'Enter');
            await flush();
            await choose('Pickup_Time__c');
            await enter('08:00:00.000');
            keyDown('.rh-mass-value', 'Enter');
            await flush();
            expect(applied.map(a => a.value)).toEqual(['2026-10-01T17:30:00.000Z', '08:00:00.000Z']);
        });

        it('offers a text area with the field’s length, and applies the text exactly as typed; empty clears it', async () => {
            await mount({ columns });
            await choose('Delivery_Notes__c');
            expect($('lightning-input.rh-mass-value')).toBeNull();
            const area = $('lightning-textarea.rh-mass-value');
            expect(area).not.toBeNull();
            expect(area.maxLength).toBe(32768);
            expect(area.label).toBe('New Delivery Notes');
            await enter('  Leave at loading dock 3\nCall ahead  ');
            await apply();
            await enter('');
            await apply();
            expect(applied).toEqual([
                { field: 'Delivery_Notes__c', value: '  Leave at loading dock 3\nCall ahead  ', valueLabel: null },
                { field: 'Delivery_Notes__c', value: null, valueLabel: null }
            ]);
        });

        it('Enter in the text area is a new line, not Apply', async () => {
            await mount({ columns });
            await choose('Delivery_Notes__c');
            await enter('Leave at loading dock 3');
            keyDown('lightning-textarea.rh-mass-value', 'Enter');
            await flush();
            expect(applied).toEqual([]);
        });

        it('refuses to clear a required text area', async () => {
            await mount({ columns });
            await choose('Handling_Instructions__c');
            expect($('lightning-textarea.rh-mass-value').maxLength).toBe(255);
            expect($('.rh-mass-hint').textContent).toBe('Handling Instructions is required, so it cannot be cleared.');
            await apply();
            expect(applied).toEqual([]);
            expect($('.rh-mass-error').textContent).toBe(REQUIRED_MESSAGE);
        });

        it('says what the rows hold now, as the grid shows a time and a date/time', async () => {
            const rows = [
                {
                    Id: 'a1',
                    Name: 'Casco Bay Marine',
                    Pickup_Time__c: '09:00:00.000Z',
                    Picked_Up__c: '2026-10-01T17:30:00.000Z'
                },
                {
                    Id: 'a2',
                    Name: 'Wachusett Paper',
                    Pickup_Time__c: '09:00:00.000Z',
                    Picked_Up__c: '2026-10-01T17:30:00.000Z'
                }
            ];
            await mount({ columns, rows, count: 2 });
            await choose('Pickup_Time__c');
            expect(words($('.rh-mass-current').textContent)).toBe('Currently: 9:00 AM on every row');
            await choose('Picked_Up__c');
            expect(words($('.rh-mass-current').textContent)).toBe('Currently: 10/1/2026, 10:30 AM on every row');
        });

        it('choosing another field starts its value afresh', async () => {
            await mount({ columns });
            await choose('Pickup_Time__c');
            await enter('13:30:00.000');
            await choose('Delivery_Notes__c');
            expect($('lightning-textarea.rh-mass-value').value).toBe('');
            await apply();
            expect(applied).toEqual([{ field: 'Delivery_Notes__c', value: null, valueLabel: null }]);
        });
    });
});
