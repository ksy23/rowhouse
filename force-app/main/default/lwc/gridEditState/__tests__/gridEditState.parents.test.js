/**
 * Columns that show a field of a parent record (Account.Industry on a
 * Contact grid): one value for every row with the same parent, so a change
 * is made on each of them, and they are read again when it is saved.
 */
import { withSameParent, rowsSharingParents } from 'c/gridEditState';

const PATHS = new Set(['Account.Industry', 'Account.Owner.Email']);
const ROWS = [
    { Id: 'r1', 'Account.Industry': 'Banking', _parents: { 'Account.Industry': 'a1' } },
    { Id: 'r2', 'Account.Industry': 'Banking', _parents: { 'Account.Industry': 'a1' } },
    { Id: 'r3', 'Account.Industry': 'Energy', _parents: { 'Account.Industry': 'a2' } },
    { Id: 'r4', 'Account.Industry': null }
];
const edit = (recordId, field, value) => ({ recordId, field, value, originalValue: null });

describe('withSameParent', () => {
    it('makes a change to a parent field on every loaded row with that parent', () => {
        const out = withSameParent([edit('r1', 'Account.Industry', 'Energy')], ROWS, PATHS);
        expect(out).toEqual([
            edit('r1', 'Account.Industry', 'Energy'),
            {
                recordId: 'r2',
                field: 'Account.Industry',
                value: 'Energy',
                originalValue: 'Banking',
                valueLabel: undefined
            }
        ]);
    });

    it('leaves the rows of other parents, and rows with none, as they are', () => {
        const out = withSameParent([edit('r3', 'Account.Industry', 'Banking')], ROWS, PATHS);
        expect(out.map(c => c.recordId)).toEqual(['r3']);
    });

    it('keeps a change the user made to a cell as made', () => {
        const changes = [edit('r1', 'Account.Industry', 'Energy'), edit('r2', 'Account.Industry', 'Retail')];
        expect(withSameParent(changes, ROWS, PATHS)).toEqual(changes);
    });

    it('returns the same changes when none is to a parent field', () => {
        const changes = [edit('r1', 'Name', 'x')];
        expect(withSameParent(changes, ROWS, PATHS)).toBe(changes);
        expect(withSameParent(changes, ROWS, new Set())).toBe(changes);
    });
});

describe('rowsSharingParents', () => {
    it('finds the other loaded rows that show a parent record the save changed', () => {
        const sent = { r1: { 'Account.Industry': 'Energy' } };
        expect(rowsSharingParents(ROWS, sent, ['r1'], PATHS)).toEqual(['r2']);
    });

    it('finds none when no parent field was saved, or the row did not save', () => {
        expect(rowsSharingParents(ROWS, { r1: { Name: 'x' } }, ['r1'], PATHS)).toEqual([]);
        expect(rowsSharingParents(ROWS, { r1: { 'Account.Industry': 'Energy' } }, [], PATHS)).toEqual([]);
    });
});
