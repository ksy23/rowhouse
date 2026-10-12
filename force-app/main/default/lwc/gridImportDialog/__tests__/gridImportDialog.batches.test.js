/**
 * Import batches: at most IMPORT_BATCH rows and IMPORT_CELLS values
 * per server call, the Id aside, because a grid that logs its changes writes a
 * log entry for each value and one call may write at most 5,000. A row is
 * never split, and the rows keep their order.
 */
import { batchesOf, IMPORT_BATCH, IMPORT_CELLS } from 'c/gridImportDialog';

const rowWith = (values, withId = true) => {
    const row = withId ? { Id: 'a01000000000001AAA' } : {};
    for (let i = 0; i < values; i++) row['Field_' + i + '__c'] = String(i);
    return row;
};
const rows = (count, values, withId) => Array.from({ length: count }, () => rowWith(values, withId));

describe('batchesOf', () => {
    it('keeps the limits the server has: 200 rows and 5,000 values', () => {
        expect(IMPORT_BATCH).toBe(200);
        expect(IMPORT_CELLS).toBe(5000);
    });

    it('sends narrow files in batches of 200 rows, as before', () => {
        const batches = batchesOf(rows(450, 3));
        expect(batches.map(b => b.length)).toEqual([200, 200, 50]);
    });

    it('makes a batch smaller when a file is wide, so its log entries fit one call', () => {
        // 60 values a row: 83 rows are 4,980 values; an 84th would be 5,040.
        const batches = batchesOf(rows(250, 60));
        expect(batches.map(b => b.length)).toEqual([83, 83, 83, 1]);
        batches.forEach(b => {
            const values = b.reduce((n, row) => n + Object.keys(row).length - 1, 0);
            expect(values).toBeLessThanOrEqual(IMPORT_CELLS);
        });
    });

    it('does not count the Id, which is not a change', () => {
        // One value and an Id a row: 200 rows, not 2,500 values' worth.
        expect(batchesOf(rows(400, 1)).map(b => b.length)).toEqual([200, 200]);
        // New rows have no Id and count the same.
        expect(batchesOf(rows(400, 1, false)).map(b => b.length)).toEqual([200, 200]);
    });

    it('never splits a row, even one with more values than a batch holds', () => {
        const wide = rowWith(6000);
        const batches = batchesOf([rowWith(2), wide, rowWith(2)]);
        expect(batches.map(b => b.length)).toEqual([1, 1, 1]);
        expect(batches[1][0]).toBe(wide);
    });

    it('keeps the rows in their order, and sends nothing for no rows', () => {
        const input = rows(5, 2).map((row, i) => ({ ...row, Name: 'Kennebec Lumber, load ' + (i + 1) }));
        expect(
            batchesOf(input)
                .flat()
                .map(r => r.Name)
        ).toEqual([
            'Kennebec Lumber, load 1',
            'Kennebec Lumber, load 2',
            'Kennebec Lumber, load 3',
            'Kennebec Lumber, load 4',
            'Kennebec Lumber, load 5'
        ]);
        expect(batchesOf([])).toEqual([]);
    });
});
