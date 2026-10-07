/**
 * The arithmetic of child tables under rows: where detail rows go, and
 * where every row's top is once some rows are open.
 */
import {
    DETAIL_HEIGHT,
    NESTED_DETAIL_HEIGHT,
    PANEL_CHROME,
    detailHeight,
    childTableHeight,
    detailId,
    withDetails,
    rowTop,
    rowAt,
    panelHeightFor,
    panelMax,
    MIN_PANEL_HEIGHT,
    PANEL_PADDING
} from 'c/gridNest';

const rows = n => Array.from({ length: n }, (_, i) => ({ Id: 'r' + i, Name: 'Row ' + i }));

describe('withDetails', () => {
    it('leaves the view alone when nothing is open', () => {
        const view = rows(3);
        const out = withDetails(view, {});
        expect(out.items).toBe(view);
        expect(out.detailRows).toEqual([]);
    });

    it('puts a detail row after each open record, and says where', () => {
        const out = withDetails(rows(4), { r1: true, r3: true });
        expect(out.items.map(r => r.Id)).toEqual(['r0', 'r1', detailId('r1'), 'r2', 'r3', detailId('r3')]);
        expect(out.detailRows).toEqual([2, 5]);
        expect(out.items[2].__detail).toEqual({ rowId: 'r1', row: out.items[1] });
    });

    it('never opens a group row, and ignores an open row that is not in the view', () => {
        const view = [{ Id: 'g1', __group: { level: 1 } }, ...rows(2)];
        const out = withDetails(view, { g1: true, r1: true, gone: true });
        expect(out.items.map(r => r.Id)).toEqual(['g1', 'r0', 'r1', detailId('r1')]);
        expect(out.detailRows).toEqual([3]);
    });

    it('uses the key field it is given', () => {
        const out = withDetails([{ Key__c: 'a' }], { a: true }, 'Key__c');
        expect(out.items[1].Key__c).toBe(detailId('a'));
    });
});

describe('rowTop and rowAt', () => {
    const H = 33;

    it('is plain multiplication with nothing open', () => {
        expect(rowTop(0, H)).toBe(0);
        expect(rowTop(10, H)).toBe(330);
        expect(rowAt(329, 100, H)).toBe(9);
        expect(rowAt(330, 100, H)).toBe(10);
    });

    it('adds each detail row above as its own height', () => {
        // Rows 0 and 1, then a detail at 2, then rows from 3.
        const details = [2];
        expect(rowTop(2, H, details)).toBe(66); // the detail row starts where row 2 would
        expect(rowTop(3, H, details)).toBe(66 + DETAIL_HEIGHT);
        expect(rowTop(4, H, details)).toBe(66 + DETAIL_HEIGHT + H);
    });

    it('finds the row at any offset, inside a detail row included', () => {
        const details = [2, 5];
        const count = 20;
        expect(rowAt(0, count, H, details)).toBe(0);
        expect(rowAt(66, count, H, details)).toBe(2); // the top of the detail row
        expect(rowAt(66 + DETAIL_HEIGHT - 1, count, H, details)).toBe(2); // still inside it
        expect(rowAt(66 + DETAIL_HEIGHT, count, H, details)).toBe(3);
        for (let i = 0; i < count; i++) {
            expect(rowAt(rowTop(i, H, details), count, H, details)).toBe(i);
        }
    });

    it('stays inside the rows at either end', () => {
        expect(rowAt(-50, 10, H)).toBe(0);
        expect(rowAt(1e9, 10, H, [3])).toBe(9);
        expect(rowAt(100, 0, H)).toBe(0);
    });

    it('the whole height is the last row\'s top plus its own', () => {
        const details = [1];
        expect(rowTop(3, H, details)).toBe(H + DETAIL_HEIGHT + H);
    });
});

describe('heights by level', () => {
    const HEADER_AND_ROW = 32 + 33; // a child table's sticky header, and one row

    it('a top-level row opens a taller panel than a level-2 row', () => {
        expect(detailHeight(1)).toBe(DETAIL_HEIGHT);
        expect(detailHeight(2)).toBe(NESTED_DETAIL_HEIGHT);
        expect(detailHeight(3)).toBe(NESTED_DETAIL_HEIGHT); // never opened: level 3 has no toggle
        expect(detailHeight(undefined)).toBe(DETAIL_HEIGHT);
    });

    it('sizes each child grid to its parent\'s panel, less the tabs and its header', () => {
        expect(childTableHeight(2)).toBe(DETAIL_HEIGHT - PANEL_CHROME);
        expect(childTableHeight(3)).toBe(NESTED_DETAIL_HEIGHT - PANEL_CHROME);
    });

    it('fits a level-2 row\'s whole panel inside a level-2 grid, with its header and a row', () => {
        // With one height for every level, a 420px panel sat in a 240px box and
        // the level-3 grid was below the fold.
        expect(detailHeight(2) + HEADER_AND_ROW).toBeLessThanOrEqual(childTableHeight(2));
    });

    it('leaves a level-3 grid room for its header and four rows', () => {
        expect(childTableHeight(3)).toBeGreaterThanOrEqual(32 + 4 * 33);
    });
});

describe('panels sized to their content', () => {
    const H = 38;

    it('takes one height per open row, in order', () => {
        const details = [1, 3]; // rows 0 and 2 are open; their panels are at 1 and 3
        expect(rowTop(2, H, details, [200, 300])).toBe(2 * H + (200 - H));
        expect(rowTop(4, H, details, [200, 300])).toBe(4 * H + (200 - H) + (300 - H));
        expect(rowTop(1, H, details, [200, 300])).toBe(H); // nothing open above row 1
    });

    it('finds the row at an offset with mixed heights', () => {
        const details = [1, 3];
        const heights = [200, 300];
        expect(rowAt(0, 6, H, details, heights)).toBe(0);
        expect(rowAt(H + 199, 6, H, details, heights)).toBe(1); // still in the first panel
        expect(rowAt(H + 200, 6, H, details, heights)).toBe(2);
        expect(rowAt(rowTop(4, H, details, heights), 6, H, details, heights)).toBe(4);
    });

    it('uses the level\'s maximum for a height it does not have', () => {
        expect(rowTop(2, H, [1], [])).toBe(2 * H + (DETAIL_HEIGHT - H));
    });

    it('clamps a measured content height between the minimum and the level\'s maximum', () => {
        expect(panelHeightFor(null, 1)).toBe(DETAIL_HEIGHT); // not measured yet
        expect(panelHeightFor(0, 1)).toBe(DETAIL_HEIGHT);
        expect(panelHeightFor(250.2, 1)).toBe(Math.ceil(250.2 + PANEL_PADDING)); // the panel's padding and border round it
        expect(panelHeightFor(40, 1)).toBe(MIN_PANEL_HEIGHT);
        expect(panelHeightFor(900, 1)).toBe(DETAIL_HEIGHT);
        expect(panelHeightFor(900, 2)).toBe(NESTED_DETAIL_HEIGHT);
    });
});

describe('the admin\'s heights', () => {
    it('size a child grid to its tab\'s Height, or to the standard', () => {
        expect(childTableHeight(2, 600)).toBe(600);
        expect(childTableHeight(2, null)).toBe(DETAIL_HEIGHT - PANEL_CHROME);
        expect(childTableHeight(3, 0)).toBe(NESTED_DETAIL_HEIGHT - PANEL_CHROME);
    });

    it('let a panel grow to the tallest tab and its chrome', () => {
        expect(panelMax(1, [{ height: 300 }, { height: 600 }, {}])).toBe(600 + PANEL_CHROME);
        expect(panelMax(1, [{}, { height: null }])).toBe(DETAIL_HEIGHT);
        expect(panelMax(2, [])).toBe(NESTED_DETAIL_HEIGHT);
        expect(panelHeightFor(1000, 1, 752)).toBe(752);
        expect(panelHeightFor(null, 1, 752)).toBe(752);
    });
});
