/**
 * New rows as plain data: a key of their own until they are saved, a mark
 * that makes them exist (so Undo and Cancel take them away), what creating
 * them sends, and how the answer comes back.
 */
import {
    NEW_MARK,
    newRowKey,
    isNewKey,
    newKeys,
    addNewRow,
    splitDrafts,
    toCreatePayload,
    newRowRequiredErrors,
    applyCreateResult,
    applyEdit,
    hasDrafts,
    REQUIRED_MESSAGE
} from 'c/gridEditState';

const COLUMNS = [
    { field: 'Name', creatable: true, required: true },
    { field: 'Stage__c', creatable: true, required: false },
    { field: 'OwnerId', creatable: true, required: true },
    { field: 'Total__c', creatable: false, required: false }
];

describe('new rows', () => {
    it('have keys that are never record Ids', () => {
        expect(newRowKey(3)).toBe('rh-new-3');
        expect(isNewKey('rh-new-3')).toBe(true);
        expect(isNewKey('a01000000000001AAA')).toBe(false);
        expect(isNewKey(null)).toBe(false);
    });

    it('exist while their draft carries the mark, and count as unsaved', () => {
        const before = { a01000000000001AAA: { Name: 'x' } };
        const after = addNewRow(before, 'rh-new-1');
        expect(after).not.toBe(before);
        expect(after['rh-new-1']).toEqual({ [NEW_MARK]: true });
        expect(newKeys(after)).toEqual(['rh-new-1']);
        expect(hasDrafts(addNewRow({}, 'rh-new-2'))).toBe(true);
        // Typing in a new row is an ordinary edit on its key.
        const typed = applyEdit(after, 'rh-new-1', 'Name', 'Baker', null);
        expect(typed['rh-new-1']).toEqual({ [NEW_MARK]: true, Name: 'Baker' });
    });

    it('split from the saved records for a save', () => {
        const drafts = {
            'rh-new-1': { [NEW_MARK]: true, Name: 'Baker' },
            'rh-new-2': { Name: 'undone row' }, // its mark was undone: not created
            a01000000000001AAA: { Name: 'Cobb 2' }
        };
        const { creates, updates } = splitDrafts(drafts);
        expect(Object.keys(creates)).toEqual(['rh-new-1']);
        expect(updates).toEqual({ a01000000000001AAA: { Name: 'Cobb 2' } });
    });

    it('send their own values for the columns a new row fills in, then what was typed', () => {
        const creates = { 'rh-new-1': { [NEW_MARK]: true, Name: 'Baker', Stage__c: '', Total__c: 4 } };
        const rows = {
            'rh-new-1': { Id: 'rh-new-1', Stage__c: 'Open', OwnerId: '005A', Total__c: 0, AccountId: '001A' }
        };
        expect(toCreatePayload(creates, rows, COLUMNS)).toEqual([
            // A typed blank wins over the default; a column the row cannot fill in, and
            // the parent (set by the server), are not sent.
            { key: 'rh-new-1', Stage__c: '', OwnerId: '005A', Name: 'Baker' }
        ]);
    });

    it('must have every required column it fills in before it is created', () => {
        const drafts = { 'rh-new-1': { [NEW_MARK]: true }, 'rh-new-2': { [NEW_MARK]: true, Name: 'Ok', OwnerId: '' } };
        const rows = {
            'rh-new-1': { Id: 'rh-new-1', OwnerId: '005A' },
            'rh-new-2': { Id: 'rh-new-2', OwnerId: '005A' }
        };
        expect(newRowRequiredErrors(drafts, rows, COLUMNS)).toEqual({
            'rh-new-1': { row: null, fields: { Name: REQUIRED_MESSAGE } },
            'rh-new-2': { row: null, fields: { OwnerId: REQUIRED_MESSAGE } }
        });
        expect(newRowRequiredErrors({ x: { Name: '' } }, {}, COLUMNS)).toEqual({});
    });

    it('lose their draft once created, and keep it, with why, when not', () => {
        const drafts = {
            'rh-new-1': { [NEW_MARK]: true, Name: 'Made' },
            'rh-new-2': { [NEW_MARK]: true, Name: 'Bad', Stage__c: 'x' },
            'rh-new-3': { [NEW_MARK]: true, Name: 'Odd' }
        };
        const result = applyCreateResult(drafts, {
            rows: [
                { key: 'rh-new-1', success: true, recordId: 'a01000000000009AAA', errors: [] },
                {
                    key: 'rh-new-2',
                    success: false,
                    errors: [
                        { fieldName: 'Stage__c', message: 'Bad value.' },
                        { fieldName: null, message: 'Duplicate.' }
                    ]
                },
                { key: 'rh-new-3', success: false, errors: [] }
            ]
        });
        expect(result.created).toEqual([{ key: 'rh-new-1', recordId: 'a01000000000009AAA' }]);
        expect(Object.keys(result.drafts)).toEqual(['rh-new-2', 'rh-new-3']);
        expect(result.errors['rh-new-2']).toEqual({ row: 'Duplicate.', fields: { Stage__c: 'Bad value.' } });
        expect(result.errors['rh-new-3']).toEqual({ row: 'Not saved.', fields: {} });
        expect(drafts['rh-new-1']).toBeDefined(); // a new object, the input untouched
    });
});
