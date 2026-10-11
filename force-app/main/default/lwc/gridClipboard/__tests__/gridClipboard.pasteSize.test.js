/**
 * The size of a paste, worked out before any cell is listed, so a huge one
 * is refused cheaply; and a paste of very many lines that no longer
 * overflows the call stack.
 */
import { pasteSize, pastePlan, parseTsv, MAX_PASTE_CELLS } from 'c/gridClipboard';

const bounds = { rowCount: 10, colCount: 4 };

describe('pasteSize', () => {
    it.each([
        ['one value into a range', [['x']], { top: 2, left: 1, bottom: 4, right: 2 }],
        ['a block repeated into a whole multiple', [['a', 'b']], { top: 1, left: 1, bottom: 2, right: 4 }],
        [
            'a block once from the top-left',
            [
                ['a', 'b'],
                ['c', 'd']
            ],
            { top: 3, left: 2, bottom: 3, right: 2 }
        ],
        ['a block that runs off the grid', [['a', 'b', 'c']], { top: 10, left: 3, bottom: 10, right: 3 }],
        ['ragged rows', [['a'], ['b', 'c', 'd'], []], { top: 9, left: 1, bottom: 9, right: 1 }],
        ['nothing', [], { top: 1, left: 1, bottom: 1, right: 1 }],
        ['a range wholly off the grid', [['a']], { top: 12, left: 1, bottom: 12, right: 1 }]
    ])('counts the cells pastePlan lists: %s', (label, block, target) => {
        const plan = pastePlan(block, target, bounds);
        const size = pasteSize(block, target, bounds);
        expect(size.cells).toBe(plan.cells.length);
        expect([size.rows, size.cols]).toEqual([plan.rows, plan.cols]);
    });

    it('measures 300,000 pasted lines without listing them, or overflowing the call stack', () => {
        const text = Array.from({ length: 300000 }, (_, i) => `${i}\tx`).join('\n');
        const block = parseTsv(text);
        const huge = { rowCount: 50000, colCount: 4 };
        const size = pasteSize(block, { top: 1, left: 1, bottom: 1, right: 1 }, huge);
        expect(size.rows).toBe(300000);
        expect(size.cols).toBe(2);
        expect(size.cells).toBe(100000); // only the grid's 50,000 rows, 2 columns each
        expect(size.cells).toBeGreaterThan(MAX_PASTE_CELLS);
    });

    it('lists the cells of 300,000 lines too, when asked: no spread into Math.max', () => {
        const block = Array.from({ length: 300000 }, () => ['x']);
        const plan = pastePlan(block, { top: 1, left: 1, bottom: 1, right: 1 }, { rowCount: 3, colCount: 1 });
        expect(plan.cells).toHaveLength(3);
        expect(plan.dropped).toBe(299997);
    });
});
