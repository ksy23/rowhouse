import {
    applyEdit,
    applyEdits,
    draftCount,
    toPayload,
    applySaveResult,
    mergeSaved,
    applyRefusedFields,
    carryNewEdits,
    clearCellError,
    requiredErrors,
    mergeErrors,
    REFUSED_BY_PERMISSION,
    REFUSED_BY_CONFIG,
    REQUIRED_MESSAGE
} from 'c/gridEditState';

describe('drafts', () => {
    it('records an edit and returns a new object every time', () => {
        const d0 = {};
        const d1 = applyEdit(d0, 'r1', 'Consignee__c', 'Casco Bay Marine', 'Kennebec Lumber');
        expect(d1).not.toBe(d0);
        expect(d1).toEqual({ r1: { Consignee__c: 'Casco Bay Marine' } });
        expect(d0).toEqual({});
    });
    it('typing a value back to the original removes the draft', () => {
        const d1 = applyEdit({}, 'r1', 'Consignee__c', 'Casco Bay Marine', 'Kennebec Lumber');
        expect(applyEdit(d1, 'r1', 'Consignee__c', 'Kennebec Lumber', 'Kennebec Lumber')).toEqual({});
    });
    it('TC-001 editing a null and cancelling with empty text is not an edit', () => {
        expect(applyEdit({}, 'r1', 'Consignee__c', '', null)).toEqual({});
    });
    it('builds the payload with Id first', () => {
        const d = applyEdit(applyEdit({}, 'r1', 'Pieces__c', 1, 0), 'r1', 'Weight__c', 2, 0);
        expect(draftCount(d)).toBe(2);
        expect(toPayload(d)).toEqual([{ Id: 'r1', Pieces__c: 1, Weight__c: 2 }]);
    });
});

describe('save results', () => {
    const drafts = { ok: { Pieces__c: 1 }, bad: { Pieces__c: 2, Weight__c: 3 } };
    const result = {
        successCount: 1,
        errors: [
            { recordId: 'bad', fieldName: 'Weight__c', message: 'Weight must be at least 10 lb.' },
            { recordId: 'bad', fieldName: null, message: 'This record is locked.' }
        ]
    };
    it('keeps drafts only for failed records, and places each error', () => {
        const { drafts: next, errors } = applySaveResult(drafts, result);
        expect(next).toEqual({ bad: { Pieces__c: 2, Weight__c: 3 } });
        expect(errors.bad.fields.Weight__c).toBe('Weight must be at least 10 lb.');
        expect(errors.bad.row).toBe('This record is locked.');
    });
    it('merges saved values into new row objects and leaves the rest alone', () => {
        const rows = [
            { Id: 'ok', Pieces__c: 0 },
            { Id: 'bad', Pieces__c: 0 },
            { Id: 'other', Pieces__c: 0 }
        ];
        const merged = mergeSaved(rows, drafts, ['bad']);
        expect(merged[0]).toEqual({ Id: 'ok', Pieces__c: 1 });
        expect(merged[1]).toBe(rows[1]);
        expect(merged[2]).toBe(rows[2]);
    });
});

describe('refused fields', () => {
    const sent = { a: { Consignee__c: 'Casco Bay Marine', Carrier_Code__c: 'GCFX' }, b: { Freight_Charge__c: 5 } };

    it('brings a refused edit back as a draft with the reason on the cell', () => {
        const state = applySaveResult(sent, { errors: [] });
        const next = applyRefusedFields(state, sent, {
            strippedFields: ['Carrier_Code__c'],
            rejectedFields: ['freight_charge__c']
        });
        expect(next.drafts).toEqual({ a: { Carrier_Code__c: 'GCFX' }, b: { Freight_Charge__c: 5 } });
        expect(next.errors.a.fields.Carrier_Code__c).toBe(REFUSED_BY_PERMISSION);
        expect(next.errors.b.fields.Freight_Charge__c).toBe(REFUSED_BY_CONFIG);
        expect(next.errors.a.fields.Consignee__c).toBeUndefined();
    });

    it('returns the same state when nothing was refused', () => {
        const state = applySaveResult(sent, { errors: [] });
        expect(applyRefusedFields(state, sent, { strippedFields: [], rejectedFields: [] })).toBe(state);
    });

    it('keeps an existing row error alongside the refused cell', () => {
        const state = {
            drafts: { a: { Consignee__c: 'Casco Bay Marine' } },
            errors: { a: { row: 'This record is locked.', fields: {} } }
        };
        const next = applyRefusedFields(state, sent, { strippedFields: ['Carrier_Code__c'] });
        expect(next.errors.a.row).toBe('This record is locked.');
        expect(next.errors.a.fields.Carrier_Code__c).toBe(REFUSED_BY_PERMISSION);
    });
});

describe('edits made during a save', () => {
    it('carries a new edit and a changed value, not what was already sent', () => {
        const sent = { a: { Pieces__c: 1 }, b: { Service_Level__c: 'Standard' } };
        const current = { a: { Pieces__c: 1 }, b: { Service_Level__c: 'Express' }, c: { Delivered__c: true } };
        expect(carryNewEdits(current, sent, {})).toEqual({
            b: { Service_Level__c: 'Express' },
            c: { Delivered__c: true }
        });
    });

    it('merges into the drafts that survived the save', () => {
        expect(carryNewEdits({ a: { Pieces__c: 2 } }, { a: { Pieces__c: 1 } }, { a: { Pieces__c: 1 } })).toEqual({
            a: { Pieces__c: 2 }
        });
    });
});

describe('clearing a cell error on edit', () => {
    const errors = {
        a: { row: null, fields: { Pieces__c: 'Enter a whole number.', Weight__c: 'Weight must be at least 10 lb.' } },
        b: { row: null, fields: { Pieces__c: 'Enter a whole number.' } }
    };

    it('removes only that cell, and the record entry once it is empty', () => {
        const once = clearCellError(errors, 'a', 'Pieces__c');
        expect(once.a.fields).toEqual({ Weight__c: 'Weight must be at least 10 lb.' });
        const twice = clearCellError(errors, 'b', 'Pieces__c');
        expect(twice.b).toBeUndefined();
        expect(errors.a.fields.Pieces__c).toBe('Enter a whole number.'); // input untouched
    });

    it('returns the same object when there was nothing to clear', () => {
        expect(clearCellError(errors, 'a', 'Delivered__c')).toBe(errors);
        expect(clearCellError(errors, 'zz', 'Pieces__c')).toBe(errors);
    });
});

describe('required fields', () => {
    const cols = [
        { field: 'Name', required: true },
        { field: 'Consignee__c', required: false }
    ];

    it('flags a blanked required field, including whitespace only, and nothing else', () => {
        const drafts = {
            a: { Name: '', Consignee__c: '' },
            b: { Name: '   ' },
            c: { Name: 'Casco Bay Marine, 4 pallets' },
            d: { Name: null }
        };
        expect(requiredErrors(drafts, cols)).toEqual({
            a: { row: null, fields: { Name: REQUIRED_MESSAGE } },
            b: { row: null, fields: { Name: REQUIRED_MESSAGE } },
            d: { row: null, fields: { Name: REQUIRED_MESSAGE } }
        });
    });

    it('merges into existing errors without losing them', () => {
        const merged = mergeErrors(
            { a: { row: 'This record is locked.', fields: { Pieces__c: 'Enter a whole number.' } } },
            { a: { row: null, fields: { Name: 'Complete this field.' } } }
        );
        expect(merged.a).toEqual({
            row: 'This record is locked.',
            fields: { Pieces__c: 'Enter a whole number.', Name: 'Complete this field.' }
        });
    });
});

describe('applyEdits', () => {
    it('applies many edits by the same rule as applyEdit, in one new object', () => {
        const d0 = { r1: { Consignee__c: 'Casco Bay Marine' }, r2: { Handling_Instructions__c: 'Liftgate required' } };
        const d1 = applyEdits(d0, [
            {
                recordId: 'r1',
                field: 'Handling_Instructions__c',
                value: 'Call ahead',
                originalValue: 'Inside delivery'
            },
            {
                recordId: 'r2',
                field: 'Handling_Instructions__c',
                value: 'Fragile, top load only',
                originalValue: 'Fragile, top load only'
            },
            { recordId: 'r3', field: 'Consignee__c', value: '', originalValue: null }
        ]);
        expect(d1).toEqual({ r1: { Consignee__c: 'Casco Bay Marine', Handling_Instructions__c: 'Call ahead' } });
        expect(d0).toEqual({
            r1: { Consignee__c: 'Casco Bay Marine' },
            r2: { Handling_Instructions__c: 'Liftgate required' }
        });
        let d2 = d0;
        [
            ['r1', 'Handling_Instructions__c', 'Call ahead', 'Inside delivery'],
            ['r2', 'Handling_Instructions__c', 'Fragile, top load only', 'Fragile, top load only'],
            ['r3', 'Consignee__c', '', null]
        ].forEach(([id, f, v, o]) => {
            d2 = applyEdit(d2, id, f, v, o);
        });
        expect(d1).toEqual(d2);
    });

    it('handles ten thousand edits without copying the drafts ten thousand times', () => {
        const changes = [];
        for (let i = 0; i < 10000; i++)
            changes.push({ recordId: 'r' + i, field: 'Pieces__c', value: i, originalValue: null });
        const started = Date.now();
        const drafts = applyEdits({}, changes);
        expect(Object.keys(drafts)).toHaveLength(10000);
        expect(Date.now() - started).toBeLessThan(1000);
    });
});
