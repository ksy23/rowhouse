/**
 * Export to Excel: the grid as the user sees it, as a sheet. The locale is
 * en-US, the currency USD and the time zone America/Los_Angeles (the Jest
 * transformer's).
 */
import {
    buildSheet,
    cellValue,
    currencyFormat,
    dateSerial,
    dateTimeSerial,
    timeSerial,
    widthInCharacters,
    aggregate
} from 'c/gridExcel';
import { toXlsx } from 'c/gridXlsxWriter';
import { readXlsx } from 'c/gridXlsx';

const COLUMNS = [
    { field: 'Name', label: 'Consignment', type: 'text', isName: true },
    { field: 'Carrier__c', label: 'Carrier', type: 'reference' },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', scale: 2, subtotal: 'sum' },
    { field: 'Pieces__c', label: 'Pieces', type: 'number', scale: 0, subtotal: 'sum' },
    { field: 'Discount__c', label: 'Discount', type: 'percent', scale: 1 },
    { field: 'Ship_Date__c', label: 'Ship Date', type: 'date' },
    { field: 'Picked_Up__c', label: 'Picked Up', type: 'datetime' },
    { field: 'Fragile__c', label: 'Fragile', type: 'checkbox' },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        groupable: true,
        options: [
            { value: 'Express', label: 'Express' },
            { value: 'two_day', label: 'Two-day' }
        ]
    },
    { field: 'Notes__c', label: 'Delivery Notes', type: 'textarea' }
];
const SHOWN = COLUMNS.map(c => ({ field: c.field, width: 150, wrapped: c.field === 'Notes__c' }));
const NAMES = { '001000000000001AAA': 'Bangor Freight Lines' };

const ROWS = [
    {
        Id: 'a00000000000001AAA',
        Name: 'Kennebec Lumber, load 1',
        Carrier__c: '001000000000001AAA',
        Freight_Charge__c: 1250.5,
        Pieces__c: 12,
        Discount__c: 12.5,
        Ship_Date__c: '2026-11-14',
        Picked_Up__c: '2026-10-19T17:30:00.000Z',
        Fragile__c: true,
        Service_Level__c: 'Express',
        Notes__c: 'Dock 4.\nCall ahead.'
    },
    {
        Id: 'a00000000000002AAA',
        Name: 'Penobscot Paper, load 2',
        Carrier__c: null,
        Freight_Charge__c: 980,
        Pieces__c: 3,
        Discount__c: null,
        Ship_Date__c: null,
        Picked_Up__c: null,
        Fragile__c: false,
        Service_Level__c: 'two_day',
        Notes__c: null
    },
    {
        Id: 'a00000000000003AAA',
        Name: 'Androscoggin Mills, load 1',
        Freight_Charge__c: 410.25,
        Pieces__c: 7,
        Fragile__c: false,
        Service_Level__c: 'Express'
    }
];

const group = (level, label, loaded, id) => ({
    Id: id,
    __group: { id, level, label, columnLabel: 'Service Level', loaded, field: 'Service_Level__c' }
});

const build = (extra = {}) =>
    buildSheet({
        title: 'Open Consignments',
        view: { columns: SHOWN, frozen: 1, items: ROWS },
        columns: COLUMNS,
        names: NAMES,
        ...extra
    });

const valuesOf = row => row.cells.map(c => (c ? c.v : null));

describe('values', () => {
    it('keeps numbers as numbers with the field’s format', () => {
        expect(cellValue(1250.5, COLUMNS[2], {}, {})).toEqual({ v: 1250.5, t: 'n', numFmt: '"$"#,##0.00' });
        expect(cellValue(12, COLUMNS[3], {}, {})).toEqual({ v: 12, t: 'n', numFmt: '#,##0' });
        expect(cellValue(3.75, { type: 'number' }, {}, {})).toEqual({ v: 3.75, t: 'n', numFmt: 0 });
    });

    it('writes a percent as a fraction shown as a percent: 12.5 is 12.5%', () => {
        expect(cellValue(12.5, COLUMNS[4], {}, {})).toEqual({ v: 0.125, t: 'n', numFmt: '#,##0.0%' });
    });

    it('writes a number past 15 significant digits as the text the grid shows', () => {
        expect(cellValue('12345678901234567890', { type: 'number', scale: 0 }, {}, {})).toEqual({
            v: '12,345,678,901,234,567,890',
            t: 's',
            align: 'right'
        });
    });

    it('shows each amount in its own currency, by code, where the org has more than one', () => {
        const col = { ...COLUMNS[2], currencyField: 'CurrencyIsoCode' };
        expect(cellValue(800, col, { CurrencyIsoCode: 'CAD' }, {})).toEqual({
            v: 800,
            t: 'n',
            numFmt: '"CAD "#,##0.00'
        });
        expect(currencyFormat('USD', false, 2)).toBe('"$"#,##0.00');
        expect(currencyFormat('EUR', false, 0)).toBe('"€"#,##0');
        expect(currencyFormat('USD', true, 2)).toBe('"USD "#,##0.00');
    });

    it('writes dates and times as Excel serials, date/times in the user’s time zone', () => {
        expect(dateSerial('2026-11-14')).toBe(46340);
        expect(dateSerial('1899-12-31')).toBeNull();
        // 17:30 UTC is 10:30 in Los Angeles, on 19 October 2026.
        expect(dateTimeSerial('2026-10-19T17:30:00.000Z', 'America/Los_Angeles')).toBeCloseTo(46314 + 10.5 / 24, 9);
        expect(timeSerial('17:30:00.000Z')).toBeCloseTo(17.5 / 24, 9);
        expect(cellValue('2026-11-14', COLUMNS[5], {}, {})).toEqual({ v: 46340, t: 'n', numFmt: 14 });
        expect(cellValue('not a date', COLUMNS[5], {}, {})).toEqual({ v: 'not a date', t: 's' });
    });

    it('writes checkboxes as TRUE or FALSE, picklists by label and lookups by name', () => {
        expect(cellValue(true, COLUMNS[7], {}, {})).toEqual({ v: true, t: 'b', align: 'center' });
        expect(cellValue('two_day', COLUMNS[8], {}, {})).toEqual({ v: 'Two-day', t: 's' });
        expect(cellValue('001000000000001AAA', COLUMNS[1], {}, NAMES)).toEqual({ v: 'Bangor Freight Lines', t: 's' });
        expect(cellValue(null, COLUMNS[1], {}, NAMES)).toBeNull();
    });

    it('turns the grid’s pixels into Excel’s characters', () => {
        expect(widthInCharacters(150)).toBe(19.7);
        expect(widthInCharacters(20)).toBe(6);
        expect(widthInCharacters(null)).toBe(18);
    });
});

describe('an ungrouped grid', () => {
    it('writes the Id first, then the columns shown, in their order', () => {
        const sheet = build({ view: { columns: [SHOWN[3], SHOWN[0]], frozen: 0, items: ROWS } });
        expect(valuesOf(sheet.rows[0])).toEqual(['Id', 'Pieces', 'Consignment']);
        expect(valuesOf(sheet.rows[1])).toEqual(['a00000000000001AAA', 12, 'Kennebec Lumber, load 1']);
        expect(sheet.rows).toHaveLength(4 + 1); // the header, three rows and the Total
        expect(sheet.freeze).toEqual({ rows: 1, columns: 0 });
        // Filter buttons over the header and the three rows; the Total row stays out, so a sort leaves it last.
        expect(sheet.autoFilter).toBe(4);
    });

    it('freezes the Id with the columns the grid freezes, and wraps the columns it wraps', () => {
        const sheet = build();
        expect(sheet.freeze).toEqual({ rows: 1, columns: 2 });
        const notes = sheet.rows[1].cells[COLUMNS.length];
        expect(notes.v).toBe('Dock 4.\nCall ahead.');
        expect(notes.style).toEqual(expect.objectContaining({ wrap: true, top: true }));
    });

    it('ends with a Total row of SUBTOTAL formulas, with their values', () => {
        const sheet = build();
        const total = sheet.rows[sheet.rows.length - 1];
        expect(total.cells[0].v).toBe('Total');
        // Freight Charge is the fourth column (D), rows 2 to 4.
        expect(total.cells[3]).toEqual(
            expect.objectContaining({
                f: 'SUBTOTAL(9,D2:D4)',
                v: 2640.75,
                style: expect.objectContaining({ numFmt: '"$"#,##0.00', bold: true })
            })
        );
        expect(total.cells[4]).toEqual(expect.objectContaining({ f: 'SUBTOTAL(9,E2:E4)', v: 22 }));
        // Columns without a subtotal stay empty.
        expect(total.cells[5].v).toBeNull();
    });

    it('adds no Total row when no column has a subtotal', () => {
        const plain = COLUMNS.map(c => ({ ...c, subtotal: null }));
        const sheet = build({ columns: plain });
        expect(sheet.rows).toHaveLength(4);
        expect(sheet.autoFilter).toBe(4);
    });

    it('does not add up amounts in more than one currency, which only the grid can convert', () => {
        const mixed = COLUMNS.map(c => (c.type === 'currency' ? { ...c, currencyField: 'CurrencyIsoCode' } : c));
        const sheet = build({ columns: mixed });
        const total = sheet.rows[sheet.rows.length - 1];
        expect(total.cells[3].f).toBeUndefined();
        expect(total.cells[4].f).toBe('SUBTOTAL(9,E2:E4)');
    });

    it('gives cells the display rules’ fills, colors and bold, and a row rule’s tint and bar', () => {
        const rules = [
            {
                name: 'Large',
                label: 'Large charge',
                field: 'Freight_Charge__c',
                type: 'currency',
                operator: 'greater_than',
                value: '1000',
                style: 'fill_amber',
                applyTo: 'cell'
            },
            {
                name: 'Big_Load',
                label: 'Big load',
                field: 'Pieces__c',
                type: 'number',
                operator: 'greater_than',
                value: '10',
                style: 'bold',
                applyTo: 'cell'
            },
            {
                name: 'Fragile',
                label: 'Fragile',
                field: 'Fragile__c',
                type: 'checkbox',
                operator: 'equals',
                value: 'true',
                style: 'fill_red',
                applyTo: 'row'
            }
        ];
        const sheet = build({ rules, today: '2026-10-19' });
        const first = sheet.rows[1].cells;
        // The row rule: a red tint on every cell, a red bar at the left edge (the Id).
        expect(first[0].style).toEqual({ fill: 'FEF1EE', borderLeft: { style: 'thick', color: 'FE5C4C' } });
        expect(first[1].style).toEqual({ fill: 'FEF1EE' });
        // The cell rules over the tint.
        expect(first[3].style).toEqual(expect.objectContaining({ fill: 'F9E3B6', numFmt: '"$"#,##0.00' }));
        expect(first[4].style).toEqual(expect.objectContaining({ bold: true, fill: 'FEF1EE' }));
        // A row no rule meets has no look of its own.
        expect(sheet.rows[2].cells[1].style).toBeNull();
        // Cells that look alike share one style object.
        expect(first[1].style).toBe(first[2].style);
    });
});

describe('a grouped grid', () => {
    const items = [group(1, 'Express', 2, '__g1_a'), ROWS[0], ROWS[2], group(1, 'Two-day', 1, '__g1_b'), ROWS[1]];
    const grouped = () => build({ view: { columns: SHOWN, frozen: 0, items } });

    it('adds a Group column with each group’s heading, and no filter buttons', () => {
        const sheet = grouped();
        expect(valuesOf(sheet.rows[0]).slice(0, 3)).toEqual(['Group', 'Id', 'Consignment']);
        expect(sheet.rows[1].cells[0].v).toBe('Service Level: Express (2)');
        expect(sheet.rows[1].cells[0].style).toEqual(expect.objectContaining({ bold: true, fill: 'F3F3F3' }));
        expect(sheet.autoFilter).toBe(false);
    });

    it('puts each group’s rows in Excel’s outline, a Subtotal row under them, and a Total row last', () => {
        const sheet = grouped();
        expect(sheet.rows.map(r => [r.level, r.cells[0] ? r.cells[0].v : null])).toEqual([
            [0, 'Group'],
            [0, 'Service Level: Express (2)'],
            [1, null],
            [1, null],
            [0, 'Subtotal: Express'],
            [0, 'Service Level: Two-day (1)'],
            [1, null],
            [0, 'Subtotal: Two-day'],
            [0, 'Total']
        ]);
        // Freight Charge is column E with the Group column first.
        expect(sheet.rows[4].cells[4]).toEqual(expect.objectContaining({ f: 'SUBTOTAL(9,E3:E4)', v: 1660.75 }));
        expect(sheet.rows[7].cells[4]).toEqual(expect.objectContaining({ f: 'SUBTOTAL(9,E7:E7)', v: 980 }));
        // The Total reaches over the subtotals, which SUBTOTAL leaves out.
        expect(sheet.rows[8].cells[4]).toEqual(expect.objectContaining({ f: 'SUBTOTAL(9,E2:E8)', v: 2640.75 }));
    });

    it('nests groups, each counting its own rows once', () => {
        const nested = [
            { ...group(1, 'Express', 2, '__g1_a') },
            { Id: '__g2_a', __group: { level: 2, label: 'Fragile', columnLabel: 'Fragile', loaded: 1 } },
            ROWS[0],
            { Id: '__g2_b', __group: { level: 2, label: 'Not fragile', columnLabel: 'Fragile', loaded: 1 } },
            ROWS[2]
        ];
        const sheet = build({ view: { columns: SHOWN, frozen: 0, items: nested } });
        expect(sheet.rows.map(r => [r.level, r.cells[0] ? r.cells[0].v : null])).toEqual([
            [0, 'Group'],
            [0, 'Service Level: Express (2)'],
            [1, 'Fragile: Fragile (1)'],
            [2, null],
            [1, 'Subtotal: Fragile'],
            [1, 'Fragile: Not fragile (1)'],
            [2, null],
            [1, 'Subtotal: Not fragile'],
            [0, 'Subtotal: Express'],
            [0, 'Total']
        ]);
        expect(sheet.rows[8].cells[4]).toEqual(expect.objectContaining({ f: 'SUBTOTAL(9,E3:E8)', v: 1660.75 }));
        expect(sheet.rows[2].cells[0].style).toEqual(expect.objectContaining({ indent: 1 }));
    });
});

describe('the file', () => {
    it('is a workbook Import reads back, with dates as dates', () => {
        const { rows } = readXlsx(toXlsx(build()));
        expect(rows[0].slice(0, 3)).toEqual([
            { t: 's', v: 'Id' },
            { t: 's', v: 'Consignment' },
            { t: 's', v: 'Carrier' }
        ]);
        expect(rows[1][3]).toEqual({ t: 'n', v: '1250.5' });
        expect(rows[1][6]).toEqual({ t: 'd', v: '2026-11-14' });
        expect(rows[1][8]).toEqual({ t: 'b', v: 'true' });
        // A percent comes back as a percent: Import puts 12.5 into the field again.
        expect(rows[1][5]).toEqual({ t: 'n', v: '0.125', pct: true });
    });
});

describe('aggregate', () => {
    it('adds, averages, finds the least and most, and counts, as SUBTOTAL does', () => {
        expect(aggregate([1, 2, 3.5], 'sum')).toBe(6.5);
        expect(aggregate([1, 2, 3], 'average')).toBe(2);
        expect(aggregate([4, 2, 9], 'min')).toBe(2);
        expect(aggregate([4, 2, 9], 'max')).toBe(9);
        expect(aggregate(['a', 2, 'b'], 'count')).toBe(3);
        expect(aggregate([], 'sum')).toBeNull();
    });
});
