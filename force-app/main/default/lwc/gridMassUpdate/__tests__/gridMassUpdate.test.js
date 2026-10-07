/**
 * The mass update dialog: which fields it offers, how it reads each kind
 * of value, what it refuses, and the keyboard. massChanges(), the rows a value
 * reaches, is tested first.
 */
import { createElement } from 'lwc';
import GridMassUpdate, { massChanges, REQUIRED_MESSAGE } from 'c/gridMassUpdate';

jest.mock('@salesforce/apex/GridController.searchLookup', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const CONTROLLING = {
    field: 'Region__c',
    label: 'Region',
    type: 'picklist',
    editable: true,
    options: [
        { value: 'North', label: 'North' },
        { value: 'South', label: 'South' }
    ]
};
const DEPENDENT = {
    field: 'City__c',
    label: 'City',
    type: 'picklist',
    editable: true,
    dependentOn: 'Region__c',
    options: [
        { value: 'Oslo', label: 'Oslo', validFor: ['North'] },
        { value: 'Rome', label: 'Rome', validFor: ['South'] }
    ]
};
const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, required: true },
    { field: 'Amount__c', label: 'Amount', type: 'currency', editable: true, scale: 2 },
    { field: 'Due__c', label: 'Due', type: 'date', editable: true },
    { field: 'Done__c', label: 'Done', type: 'checkbox', editable: true },
    {
        field: 'Stage__c',
        label: 'Stage',
        type: 'picklist',
        editable: true,
        options: [
            { value: 'Beta', label: 'Beta' },
            { value: 'Gamma', label: 'Gamma' }
        ]
    },
    {
        field: 'Colors__c',
        label: 'Colors',
        type: 'multipicklist',
        editable: true,
        options: [
            { value: 'Red', label: 'Red' },
            { value: 'Blue', label: 'Blue' }
        ]
    },
    { field: 'Account__c', label: 'Account', type: 'reference', editable: true },
    { field: 'Formula__c', label: 'Formula', type: 'number', editable: false },
    CONTROLLING,
    DEPENDENT
];
// The kinds that came with the new editors, kept apart so the counts above stay as they were.
const D46_COLUMNS = [
    { field: 'Meeting__c', label: 'Meeting', type: 'datetime', editable: true },
    { field: 'Opens__c', label: 'Opens', type: 'time', editable: true },
    { field: 'Notes__c', label: 'Notes', type: 'textarea', editable: true, length: 32768 },
    { field: 'Summary__c', label: 'Summary', type: 'textarea', editable: true, required: true, length: 255 }
];
// Some versions of Intl put a narrow space before AM and PM; read it as a space.
const words = text => String(text).replace(/\s/g, ' ');

describe('massChanges', () => {
    const rows = [
        { Id: 'a1', Region__c: 'North', City__c: 'Oslo', Amount__c: '5' },
        { Id: 'a2', Region__c: 'South', City__c: 'Rome', Amount__c: '7' },
        { Id: 'a3', Region__c: null, City__c: null, Amount__c: null }
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
            { recordId: 'a1', field: 'Amount__c', value: '10.00', originalValue: '5' },
            { recordId: 'a3', field: 'Amount__c', value: '10.00', originalValue: null }
        ]);
        expect(out.errors).toEqual([]);
    });

    it('refuses a dependent value on rows whose controlling value does not offer it, reading unsaved edits', () => {
        const drafts = { a2: { Region__c: 'North' } }; // a2 is North now, unsaved
        const out = massChanges({
            ids: ['a1', 'a2', 'a3'],
            column: DEPENDENT,
            value: 'Oslo',
            rowById,
            drafts,
            columns: COLUMNS
        });
        expect(out.changes.map(c => c.recordId)).toEqual(['a1', 'a2']);
        expect(out.errors).toEqual([
            { recordId: 'a3', field: 'City__c', message: 'Oslo is not offered when Region is blank.' }
        ]);
    });

    it('clears dependent values a new controlling value no longer allows, in the same changes', () => {
        const out = massChanges({
            ids: ['a1', 'a2'],
            column: CONTROLLING,
            value: 'North',
            rowById,
            drafts: {},
            columns: COLUMNS
        });
        // a1 is already North: nothing to clear. a2's Rome is not a northern city.
        expect(out.cleared).toEqual([{ recordId: 'a2', field: 'City__c', value: null, originalValue: 'Rome' }]);
        expect(out.changes).toHaveLength(3);
    });
});

describe('the dialog', () => {
    let el;
    let applied;
    let cancelled;
    const $ = selector => el.shadowRoot.querySelector(selector);
    const mount = async props => {
        el = createElement('c-grid-mass-update', { is: GridMassUpdate });
        Object.assign(el, { columns: COLUMNS, count: 3, configName: 'Test_Records', ...props });
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
            { Id: 'a1', Name: 'Acme', Stage__c: 'Beta', Account__c: '001000000000001AAA' },
            { Id: 'a2', Name: 'Globex', Stage__c: 'Beta', Account__c: null },
            { Id: 'a3', Name: 'Initech', Stage__c: null, Account__c: '001000000000001AAA' },
            { Id: 'a4', Name: 'Umbrella', Stage__c: 'Gamma', Account__c: null }
        ];

        it('names the rows it changes, the first few and how many more', async () => {
            await mount({ rows: ROWS, count: 4 });
            expect($('.rh-mass-rows').textContent).toBe('Acme, Globex, Initech and 1 more');
            document.body.firstChild.remove();
            await mount({ rows: ROWS.slice(0, 2), count: 2 });
            expect($('.rh-mass-rows').textContent).toBe('Acme and Globex');
            // Read with the dialog's description.
            expect($('#description, [id^="description"]').textContent).toContain('Acme and Globex');
        });

        it('says what the chosen field holds now, the commonest first', async () => {
            await mount({ rows: ROWS, count: 4 });
            expect($('.rh-mass-current')).toBeNull(); // no field chosen yet
            await choose('Stage__c');
            expect($('.rh-mass-current').textContent).toBe('Currently: Beta (2), blank (1), Gamma (1)');
        });

        it('says so when every row holds the same', async () => {
            await mount({ rows: ROWS.slice(0, 2), count: 2 });
            await choose('Stage__c');
            expect($('.rh-mass-current').textContent).toBe('Currently: Beta on every row');
        });

        it("shows a lookup's current values by name", async () => {
            await mount({ rows: ROWS, count: 4, refNames: { '001000000000001AAA': 'Alpha Corp' } });
            await choose('Account__c');
            expect($('.rh-mass-current').textContent).toBe('Currently: Alpha Corp (2), blank (2)');
        });

        it('is tall only for a lookup or a multi-select, where a list opens inside it', async () => {
            await mount({ rows: ROWS, count: 4 });
            await choose('Amount__c');
            expect($('.rh-mass-body').classList).not.toContain('rh-mass-body_tall');
            await choose('Account__c');
            expect($('.rh-mass-body').classList).toContain('rh-mass-body_tall');
            await choose('Colors__c');
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
        expect($('.rh-mass-field').options.map(o => o.value)).not.toContain('Formula__c');
        expect($('.rh-mass-field').options).toHaveLength(9);
        expect($('.rh-mass-apply').disabled).toBe(true);
        document.body.firstChild.remove();
        await mount({ columns: [COLUMNS[1], COLUMNS[7]] });
        expect($('.rh-mass-field').value).toBe('Amount__c');
        expect($('lightning-input.rh-mass-value')).not.toBeNull();
    });

    it('reads a number as the grid reads a paste, and refuses one it cannot read', async () => {
        await mount();
        await choose('Amount__c');
        await enter('$1,234.567');
        await apply();
        expect(applied).toEqual([{ field: 'Amount__c', value: 1234.57, valueLabel: null }]);
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
        await enter('Acme');
        expect($('.rh-mass-error')).toBeNull();
        await apply();
        expect(applied).toEqual([{ field: 'Name', value: 'Acme', valueLabel: null }]);
    });

    it('takes a date, a checkbox, a picklist and --None--, and a multi-select', async () => {
        await mount();
        await choose('Due__c');
        await enter('2026-12-31');
        await apply();
        await choose('Done__c');
        expect($('.rh-mass-apply').disabled).toBe(true); // Checked or Unchecked must be chosen
        await enter('false');
        await apply();
        await choose('Stage__c');
        expect($('.rh-mass-value').options[0]).toEqual({ label: '--None--', value: '' });
        await enter('');
        await apply();
        await choose('Colors__c');
        await enter(['Red', 'Blue']);
        await apply();
        expect(applied.map(a => a.value)).toEqual(['2026-12-31', false, null, 'Red;Blue']);
    });

    it('takes the record chosen in the lookup, with its name', async () => {
        await mount();
        await choose('Account__c');
        const lookup = $('c-cell-lookup');
        expect(lookup.mode).toBe('edit');
        expect(lookup.field).toBe('Account__c');
        expect(lookup.tabLeaves).toBe(true);
        lookup.dispatchEvent(new CustomEvent('commit', { detail: { value: '001000000000001AAA', label: 'Acme' } }));
        await flush();
        // The choice goes back into the search box, so leaving it with Tab keeps it.
        expect(lookup.value).toBe('001000000000001AAA');
        expect(lookup.valueLabel).toBe('Acme');
        await apply();
        expect(applied).toEqual([{ field: 'Account__c', value: '001000000000001AAA', valueLabel: 'Acme' }]);
    });

    it('explains a dependent picklist', async () => {
        await mount();
        await choose('City__c');
        expect($('.rh-mass-hint').textContent).toBe(
            'Rows where Region does not offer the value keep theirs, and are marked.'
        );
    });

    it('applies on Enter in a text box, and cancels on Escape and Cancel', async () => {
        await mount();
        await choose('Amount__c');
        await enter('5');
        $('.rh-mass-value').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })
        );
        await flush();
        expect(applied).toEqual([{ field: 'Amount__c', value: 5, valueLabel: null }]);
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
            await choose('Meeting__c');
            const input = $('lightning-input.rh-mass-value');
            expect(input.type).toBe('datetime');
            expect(input.timezone).toBe('America/Los_Angeles');
            expect(input.label).toBe('New Meeting');
            expect($('.rh-mass-hint').textContent).toBe('Leave it empty to clear Meeting.');
            await enter('2026-10-01T17:30:00.000Z');
            await apply();
            await enter('');
            await apply();
            expect(applied).toEqual([
                { field: 'Meeting__c', value: '2026-10-01T17:30:00.000Z', valueLabel: null },
                { field: 'Meeting__c', value: null, valueLabel: null }
            ]);
        });

        it('offers a time picker, and applies its time as Salesforce writes a Time; empty clears it', async () => {
            await mount({ columns });
            await choose('Opens__c');
            const input = $('lightning-input.rh-mass-value');
            expect(input.type).toBe('time');
            expect(input.label).toBe('New Opens');
            await enter('13:30:00.000');
            await apply();
            await enter('');
            await apply();
            expect(applied).toEqual([
                { field: 'Opens__c', value: '13:30:00.000Z', valueLabel: null },
                { field: 'Opens__c', value: null, valueLabel: null }
            ]);
        });

        it('refuses a time it cannot read', async () => {
            await mount({ columns });
            await choose('Opens__c');
            await enter('lunch');
            await apply();
            expect(applied).toEqual([]);
            expect($('.rh-mass-error').textContent).toBe('Not a time: lunch');
        });

        it('applies on Enter in the date/time and time pickers', async () => {
            await mount({ columns });
            await choose('Meeting__c');
            await enter('2026-10-01T17:30:00.000Z');
            keyDown('.rh-mass-value', 'Enter');
            await flush();
            await choose('Opens__c');
            await enter('08:00:00.000');
            keyDown('.rh-mass-value', 'Enter');
            await flush();
            expect(applied.map(a => a.value)).toEqual(['2026-10-01T17:30:00.000Z', '08:00:00.000Z']);
        });

        it('offers a text area with the field’s length, and applies the text exactly as typed; empty clears it', async () => {
            await mount({ columns });
            await choose('Notes__c');
            expect($('lightning-input.rh-mass-value')).toBeNull();
            const area = $('lightning-textarea.rh-mass-value');
            expect(area).not.toBeNull();
            expect(area.maxLength).toBe(32768);
            expect(area.label).toBe('New Notes');
            await enter('  Line one\nLine two  ');
            await apply();
            await enter('');
            await apply();
            expect(applied).toEqual([
                { field: 'Notes__c', value: '  Line one\nLine two  ', valueLabel: null },
                { field: 'Notes__c', value: null, valueLabel: null }
            ]);
        });

        it('Enter in the text area is a new line, not Apply', async () => {
            await mount({ columns });
            await choose('Notes__c');
            await enter('Line one');
            keyDown('lightning-textarea.rh-mass-value', 'Enter');
            await flush();
            expect(applied).toEqual([]);
        });

        it('refuses to clear a required text area', async () => {
            await mount({ columns });
            await choose('Summary__c');
            expect($('lightning-textarea.rh-mass-value').maxLength).toBe(255);
            expect($('.rh-mass-hint').textContent).toBe('Summary is required, so it cannot be cleared.');
            await apply();
            expect(applied).toEqual([]);
            expect($('.rh-mass-error').textContent).toBe(REQUIRED_MESSAGE);
        });

        it('says what the rows hold now, as the grid shows a time and a date/time', async () => {
            const rows = [
                { Id: 'a1', Name: 'Acme', Opens__c: '09:00:00.000Z', Meeting__c: '2026-10-01T17:30:00.000Z' },
                { Id: 'a2', Name: 'Globex', Opens__c: '09:00:00.000Z', Meeting__c: '2026-10-01T17:30:00.000Z' }
            ];
            await mount({ columns, rows, count: 2 });
            await choose('Opens__c');
            expect(words($('.rh-mass-current').textContent)).toBe('Currently: 9:00 AM on every row');
            await choose('Meeting__c');
            expect(words($('.rh-mass-current').textContent)).toBe('Currently: 10/1/2026, 10:30 AM on every row');
        });

        it('choosing another field starts its value afresh', async () => {
            await mount({ columns });
            await choose('Opens__c');
            await enter('13:30:00.000');
            await choose('Notes__c');
            expect($('lightning-textarea.rh-mass-value').value).toBe('');
            await apply();
            expect(applied).toEqual([{ field: 'Notes__c', value: null, valueLabel: null }]);
        });
    });
});
