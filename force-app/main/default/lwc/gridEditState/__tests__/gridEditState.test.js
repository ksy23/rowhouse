import {
    applyEdit, applyEdits, draftCount, toPayload, applySaveResult, mergeSaved,
    applyRefusedFields, carryNewEdits, clearCellError, requiredErrors, mergeErrors,
    REFUSED_BY_PERMISSION, REFUSED_BY_CONFIG, REQUIRED_MESSAGE
} from 'c/gridEditState';

describe('drafts', () => {
    it('records an edit and returns a new object every time', () => {
        const d0 = {};
        const d1 = applyEdit(d0, 'r1', 'A', 'x', 'old');
        expect(d1).not.toBe(d0);
        expect(d1).toEqual({ r1: { A: 'x' } });
        expect(d0).toEqual({});
    });
    it('typing a value back to the original removes the draft', () => {
        const d1 = applyEdit({}, 'r1', 'A', 'x', 'old');
        expect(applyEdit(d1, 'r1', 'A', 'old', 'old')).toEqual({});
    });
    it('TC-001 editing a null and cancelling with empty text is not an edit', () => {
        expect(applyEdit({}, 'r1', 'A', '', null)).toEqual({});
    });
    it('builds the payload with Id first', () => {
        const d = applyEdit(applyEdit({}, 'r1', 'A', 1, 0), 'r1', 'B', 2, 0);
        expect(draftCount(d)).toBe(2);
        expect(toPayload(d)).toEqual([{ Id: 'r1', A: 1, B: 2 }]);
    });
});

describe('save results', () => {
    const drafts = { ok: { A: 1 }, bad: { A: 2, B: 3 } };
    const result = { successCount: 1, errors: [{ recordId: 'bad', fieldName: 'B', message: 'Too big' }, { recordId: 'bad', fieldName: null, message: 'Locked' }] };
    it('keeps drafts only for failed records, and places each error', () => {
        const { drafts: next, errors } = applySaveResult(drafts, result);
        expect(next).toEqual({ bad: { A: 2, B: 3 } });
        expect(errors.bad.fields.B).toBe('Too big');
        expect(errors.bad.row).toBe('Locked');
    });
    it('merges saved values into new row objects and leaves the rest alone', () => {
        const rows = [{ Id: 'ok', A: 0 }, { Id: 'bad', A: 0 }, { Id: 'other', A: 0 }];
        const merged = mergeSaved(rows, drafts, ['bad']);
        expect(merged[0]).toEqual({ Id: 'ok', A: 1 });
        expect(merged[1]).toBe(rows[1]);
        expect(merged[2]).toBe(rows[2]);
    });
});

describe('refused fields', () => {
    const sent = { a: { Text_Field__c: 'x', Read_Only_Text__c: 'y' }, b: { Currency_Field__c: 5 } };

    it('brings a refused edit back as a draft with the reason on the cell', () => {
        const state = applySaveResult(sent, { errors: [] });
        const next = applyRefusedFields(state, sent, {
            strippedFields: ['Read_Only_Text__c'], rejectedFields: ['currency_field__c']
        });
        expect(next.drafts).toEqual({ a: { Read_Only_Text__c: 'y' }, b: { Currency_Field__c: 5 } });
        expect(next.errors.a.fields.Read_Only_Text__c).toBe(REFUSED_BY_PERMISSION);
        expect(next.errors.b.fields.Currency_Field__c).toBe(REFUSED_BY_CONFIG);
        expect(next.errors.a.fields.Text_Field__c).toBeUndefined();
    });

    it('returns the same state when nothing was refused', () => {
        const state = applySaveResult(sent, { errors: [] });
        expect(applyRefusedFields(state, sent, { strippedFields: [], rejectedFields: [] })).toBe(state);
    });

    it('keeps an existing row error alongside the refused cell', () => {
        const state = { drafts: { a: { Text_Field__c: 'x' } }, errors: { a: { row: 'Locked.', fields: {} } } };
        const next = applyRefusedFields(state, sent, { strippedFields: ['Read_Only_Text__c'] });
        expect(next.errors.a.row).toBe('Locked.');
        expect(next.errors.a.fields.Read_Only_Text__c).toBe(REFUSED_BY_PERMISSION);
    });
});

describe('edits made during a save', () => {
    it('carries a new edit and a changed value, not what was already sent', () => {
        const sent = { a: { X: 1 }, b: { Y: 'old' } };
        const current = { a: { X: 1 }, b: { Y: 'newer' }, c: { Z: true } };
        expect(carryNewEdits(current, sent, {})).toEqual({ b: { Y: 'newer' }, c: { Z: true } });
    });

    it('merges into the drafts that survived the save', () => {
        expect(carryNewEdits({ a: { X: 2 } }, { a: { X: 1 } }, { a: { X: 1 } })).toEqual({ a: { X: 2 } });
    });
});

describe('clearing a cell error on edit', () => {
    const errors = { a: { row: null, fields: { X: 'bad', Y: 'bad' } }, b: { row: null, fields: { X: 'bad' } } };

    it('removes only that cell, and the record entry once it is empty', () => {
        const once = clearCellError(errors, 'a', 'X');
        expect(once.a.fields).toEqual({ Y: 'bad' });
        const twice = clearCellError(errors, 'b', 'X');
        expect(twice.b).toBeUndefined();
        expect(errors.a.fields.X).toBe('bad'); // input untouched
    });

    it('returns the same object when there was nothing to clear', () => {
        expect(clearCellError(errors, 'a', 'Z')).toBe(errors);
        expect(clearCellError(errors, 'zz', 'X')).toBe(errors);
    });
});

describe('required fields', () => {
    const cols = [{ field: 'Name', required: true }, { field: 'Text_Field__c', required: false }];

    it('flags a blanked required field, including whitespace only, and nothing else', () => {
        const drafts = { a: { Name: '', Text_Field__c: '' }, b: { Name: '   ' }, c: { Name: 'ok' }, d: { Name: null } };
        expect(requiredErrors(drafts, cols)).toEqual({
            a: { row: null, fields: { Name: REQUIRED_MESSAGE } },
            b: { row: null, fields: { Name: REQUIRED_MESSAGE } },
            d: { row: null, fields: { Name: REQUIRED_MESSAGE } }
        });
    });

    it('merges into existing errors without losing them', () => {
        const merged = mergeErrors({ a: { row: 'Locked.', fields: { X: 'bad' } } }, { a: { row: null, fields: { Name: 'Complete this field.' } } });
        expect(merged.a).toEqual({ row: 'Locked.', fields: { X: 'bad', Name: 'Complete this field.' } });
    });
});

describe('applyEdits', () => {
    it('applies many edits by the same rule as applyEdit, in one new object', () => {
        const d0 = { r1: { A: 'kept' }, r2: { B: 'draft' } };
        const d1 = applyEdits(d0, [
            { recordId: 'r1', field: 'B', value: 'x', originalValue: 'old' },
            { recordId: 'r2', field: 'B', value: 'orig', originalValue: 'orig' },
            { recordId: 'r3', field: 'A', value: '', originalValue: null }
        ]);
        expect(d1).toEqual({ r1: { A: 'kept', B: 'x' } });
        expect(d0).toEqual({ r1: { A: 'kept' }, r2: { B: 'draft' } });
        let d2 = d0;
        [['r1', 'B', 'x', 'old'], ['r2', 'B', 'orig', 'orig'], ['r3', 'A', '', null]].forEach(([id, f, v, o]) => {
            d2 = applyEdit(d2, id, f, v, o);
        });
        expect(d1).toEqual(d2);
    });

    it('handles ten thousand edits without copying the drafts ten thousand times', () => {
        const changes = [];
        for (let i = 0; i < 10000; i++) changes.push({ recordId: 'r' + i, field: 'A', value: i, originalValue: null });
        const started = Date.now();
        const drafts = applyEdits({}, changes);
        expect(Object.keys(drafts)).toHaveLength(10000);
        expect(Date.now() - started).toBeLessThan(1000);
    });
});
