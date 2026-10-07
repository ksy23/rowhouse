/**
 * More grouping: weeks and fiscal periods, the groups' order by a
 * count or a subtotal, each group's share of the whole list, and subtotals
 * that follow unsaved edits.
 */
import {
    keyFor,
    groupLabel,
    weekStart,
    fiscalOf,
    buildView,
    rollUp,
    withDrafts,
    shareOf,
    shareText,
    normalizeOrder,
    subtotalFor
} from 'c/gridGroups';

const DATE = { field: 'Close__c', label: 'Close', type: 'date' };
const STAGE = {
    field: 'Stage__c',
    label: 'Stage',
    type: 'picklist',
    options: [
        { value: 'Open', label: 'Open' },
        { value: 'Won', label: 'Won' },
        { value: 'Lost', label: 'Lost' }
    ]
};
const AMOUNT = { field: 'Amount__c', label: 'Amount', type: 'currency', scale: 2, subtotal: 'sum' };
const LOW = { field: 'Low__c', label: 'Low', type: 'number', scale: 0, subtotal: 'min' };
const COLUMNS = [STAGE, DATE, AMOUNT, LOW];

describe('weeks', () => {
    it('start on the first day of the week, Sunday by default', () => {
        expect(weekStart('2026-10-05', 0)).toBe('2026-10-04'); // a Monday: the Sunday before
        expect(weekStart('2026-10-04', 0)).toBe('2026-10-04'); // a Sunday is its own week's start
        expect(weekStart('2026-10-05', 1)).toBe('2026-10-05'); // weeks from Monday
        expect(weekStart('2026-01-02', 1)).toBe('2025-12-29'); // across the year's end
    });

    it('key a date by its week, and name the group after the week', () => {
        expect(keyFor('2026-10-07', DATE, 'week')).toBe('2026-10-04');
        expect(groupLabel('2026-10-04', DATE, 'week')).toMatch(/^Week of /);
    });

    it("key a date/time by the week of its day in the user's time zone", () => {
        expect(keyFor('2026-10-07T12:00:00.000Z', { field: 'When__c', type: 'datetime' }, 'week', 'UTC')).toBe(
            '2026-10-04'
        );
    });
});

describe('fiscal periods', () => {
    it('follow the calendar for a year that starts in January', () => {
        expect(fiscalOf('2026-05-01', { startMonth: 1 })).toEqual({ year: '2026', quarter: 2 });
        expect(keyFor('2026-05-01', DATE, 'fiscal_quarter', undefined, { startMonth: 1 })).toBe('FY2026-Q2');
        expect(keyFor('2026-05-01', DATE, 'fiscal_year', undefined, null)).toBe('FY2026');
    });

    it('are named after the year they end in, unless the org names them after the year they start in', () => {
        // A fiscal year from April: April 2026 to March 2027.
        expect(fiscalOf('2026-05-01', { startMonth: 4 })).toEqual({ year: '2027', quarter: 1 });
        expect(fiscalOf('2027-03-31', { startMonth: 4 })).toEqual({ year: '2027', quarter: 4 });
        expect(fiscalOf('2026-03-31', { startMonth: 4 })).toEqual({ year: '2026', quarter: 4 });
        expect(fiscalOf('2026-05-01', { startMonth: 4, nameByStart: true })).toEqual({ year: '2026', quarter: 1 });
    });

    it("take the org's own years and quarters where it has defined them", () => {
        const fiscal = {
            startMonth: 1,
            periods: [
                { type: 'year', start: '2026-02-01', end: '2027-01-30', number: 1, name: '2027' },
                { type: 'quarter', start: '2026-02-01', end: '2026-05-02', number: 1, name: '2027' },
                { type: 'quarter', start: '2026-05-03', end: '2026-08-01', number: 2, name: '2027' }
            ]
        };
        expect(fiscalOf('2026-05-03', fiscal)).toEqual({ year: '2027', quarter: 2 });
        // Outside the defined years: from the start month.
        expect(fiscalOf('2025-06-01', fiscal)).toEqual({ year: '2025', quarter: 2 });
    });

    it('are named as Salesforce names them', () => {
        expect(groupLabel('FY2026-Q3', DATE, 'fiscal_quarter')).toBe('Q3 FY 2026');
        expect(groupLabel('FY2026', DATE, 'fiscal_year')).toBe('FY 2026');
    });
});

const ROWS = [
    { Id: 'r1', Stage__c: 'Open', Amount__c: '100', Low__c: '5' },
    { Id: 'r2', Stage__c: 'Open', Amount__c: '50', Low__c: '9' },
    { Id: 'r3', Stage__c: 'Won', Amount__c: '500', Low__c: '1' },
    { Id: 'r4', Stage__c: 'Lost', Amount__c: '25', Low__c: '7' }
];
const LEVELS = [{ field: 'Stage__c', unit: null }];
const SERVER = [
    { k: ['Open'], n: 2, v: { Amount__c: { s: '150' }, Low__c: { mn: '5' } } },
    { k: ['Won'], n: 1, v: { Amount__c: { s: '500' }, Low__c: { mn: '1' } } },
    { k: ['Lost'], n: 1, v: { Amount__c: { s: '25' }, Low__c: { mn: '7' } } }
];
const totals = () => rollUp(SERVER, LEVELS, COLUMNS);
const groupNames = view => view.items.filter(r => r.__group).map(r => r.__group.label);

describe("the groups' order", () => {
    it('is by name until the user asks otherwise; anything unknown is by name', () => {
        expect(normalizeOrder(null, COLUMNS)).toEqual({ by: 'name', direction: 'asc' });
        expect(normalizeOrder({ by: 'Nope__c' }, COLUMNS)).toEqual({ by: 'name', direction: 'asc' });
        expect(normalizeOrder({ by: 'count' }, COLUMNS)).toEqual({ by: 'count', direction: 'desc' });
        expect(normalizeOrder({ by: 'Amount__c', direction: 'asc' }, COLUMNS)).toEqual({
            by: 'Amount__c',
            direction: 'asc'
        });
    });

    it('can be by a subtotal, largest first or smallest first', () => {
        const options = { columns: COLUMNS, totals: totals() };
        expect(groupNames(buildView(ROWS, LEVELS, options))).toEqual(['Open', 'Won', 'Lost']); // the picklist's order
        expect(
            groupNames(buildView(ROWS, LEVELS, { ...options, order: { by: 'Amount__c', direction: 'desc' } }))
        ).toEqual(['Won', 'Open', 'Lost']);
        expect(
            groupNames(buildView(ROWS, LEVELS, { ...options, order: { by: 'Amount__c', direction: 'asc' } }))
        ).toEqual(['Lost', 'Open', 'Won']);
    });

    it('can be by record count, ties keeping their order by name', () => {
        const view = buildView(ROWS, LEVELS, {
            columns: COLUMNS,
            totals: totals(),
            order: { by: 'count', direction: 'desc' }
        });
        expect(groupNames(view)).toEqual(['Open', 'Won', 'Lost']);
    });

    it('keeps blank last', () => {
        const rows = ROWS.concat([{ Id: 'r5', Stage__c: null, Amount__c: '9999' }]);
        const server = SERVER.concat([{ k: [''], n: 1, v: { Amount__c: { s: '9999' } } }]);
        const view = buildView(rows, LEVELS, {
            columns: COLUMNS,
            totals: rollUp(server, LEVELS, COLUMNS),
            order: { by: 'Amount__c', direction: 'desc' }
        });
        expect(groupNames(view)).toEqual(['Won', 'Open', 'Lost', '(blank)']);
    });
});

describe('percent of total', () => {
    it("is a group's count, or its sum, over the whole list's", () => {
        const t = totals();
        const open = t.byPath.get('open');
        expect(shareOf(open, t.total, null)).toBeCloseTo(0.5);
        expect(shareOf(open, t.total, AMOUNT)).toBeCloseTo(150 / 675);
        expect(shareOf(open, t.total, LOW)).toBeNull(); // a lowest value has no share
        expect(shareText(0.5)).toBe('50%');
        expect(shareText(0.004)).toBe('<1%');
        expect(shareText(null)).toBe('');
    });
});

describe('subtotals with unsaved edits', () => {
    const t = totals();
    const sum = (agg, column = AMOUNT) => Number(subtotalFor(agg, column).value);

    it("are the server's when nothing is edited", () => {
        expect(withDrafts(t, ROWS, {}, LEVELS, COLUMNS)).toBe(t);
        expect(withDrafts(t, ROWS, { r1: { Stage__c: 'Won' } }, LEVELS, COLUMNS)).toBe(t); // no subtotal moved
    });

    it('add an edit to its group and the Total, and say which column it moved', () => {
        const shown = withDrafts(t, ROWS, { r1: { Amount__c: '130' } }, LEVELS, COLUMNS);
        expect(sum(shown.byPath.get('open'))).toBe(180);
        expect(sum(shown.total)).toBe(705);
        expect(shown.byPath.get('open').edited).toEqual({ Amount__c: true });
        expect(shown.byPath.get('won').edited).toBeUndefined();
        expect(sum(t.byPath.get('open'))).toBe(150); // the server's own is left alone
    });

    it('take a cleared value out of a sum', () => {
        const shown = withDrafts(t, ROWS, { r3: { Amount__c: null } }, LEVELS, COLUMNS);
        expect(subtotalFor(shown.byPath.get('won'), AMOUNT).value).toBe('0');
        expect(sum(shown.total)).toBe(175);
    });

    it('follow an edit past the lowest value', () => {
        const shown = withDrafts(t, ROWS, { r2: { Low__c: '2' } }, LEVELS, COLUMNS);
        expect(subtotalFor(shown.byPath.get('open'), LOW).value).toBe('2');
        expect(shown.byPath.get('open').unknown).toEqual({});
    });

    it('work the lowest out again from the rows when every row is loaded, or leave it as saved until the save', () => {
        const drafts = { r1: { Low__c: '8' } }; // the Open group's lowest, 5, goes up to 8
        const partial = withDrafts(t, ROWS, drafts, LEVELS, COLUMNS);
        expect(subtotalFor(partial.byPath.get('open'), LOW).value).toBe('5');
        expect(partial.byPath.get('open').unknown).toEqual({ Low__c: true });
        const complete = withDrafts(t, ROWS, drafts, LEVELS, COLUMNS, { complete: true });
        expect(subtotalFor(complete.byPath.get('open'), LOW).value).toBe('8');
        expect(complete.byPath.get('open').unknown).toEqual({});
    });

    it('count a row in the group of its saved value, whatever its edit to the grouped column says', () => {
        const shown = withDrafts(t, ROWS, { r1: { Stage__c: 'Won', Amount__c: '101' } }, LEVELS, COLUMNS);
        expect(sum(shown.byPath.get('open'))).toBe(151);
        expect(sum(shown.byPath.get('won'))).toBe(500);
    });
});
