/**
 * Conditional formatting rules: what each operator means for each type,
 * and which classes a cell ends up with when several rules match.
 */
import { compileRules, formatsFor, legendFor, resolveDate, dateIn, STYLES } from 'c/gridFormatRules';

const CONTEXT = { today: '2026-09-28', timeZone: 'America/New_York', userId: '005000000000001AAA' };
const one = (rule, value) =>
    compileRules([{ field: 'F', style: 'bold', applyTo: 'cell', ...rule }], CONTEXT)[0].test(value);

describe('dates', () => {
    it('resolves TODAY and an offset in days, across month and year ends', () => {
        expect(resolveDate('TODAY', '2026-09-28')).toBe('2026-09-28');
        expect(resolveDate('TODAY+7', '2026-09-28')).toBe('2026-10-05');
        expect(resolveDate('TODAY-30', '2026-03-01')).toBe('2026-01-30');
        expect(resolveDate('TODAY+1', '2026-12-31')).toBe('2027-01-01');
        expect(resolveDate('2026-12-31', '2026-09-28')).toBe('2026-12-31');
    });

    it('reads the calendar day of an instant in the user’s time zone', () => {
        // TC-029: 23:30 UTC on 31 January is still 31 January in New York...
        expect(dateIn(new Date('2026-01-31T23:30:00.000Z'), 'America/New_York')).toBe('2026-01-31');
        // ...and already 1 February in Tokyo.
        expect(dateIn(new Date('2026-01-31T23:30:00.000Z'), 'Asia/Tokyo')).toBe('2026-02-01');
    });
});

describe('each type', () => {
    it('compares numbers as numbers, large ones arriving as strings', () => {
        const rule = { type: 'currency', operator: 'greater_or_equal', value: '1000' };
        expect(one(rule, '4999.00')).toBe(true);
        expect(one(rule, 999.99)).toBe(false);
        expect(one(rule, '1000')).toBe(true);
        expect(one({ type: 'number', operator: 'less_than', value: '0' }, '-1234.56')).toBe(true);
        expect(one({ type: 'number', operator: 'greater_than', value: '1' }, '1000000000000000000')).toBe(true);
        expect(one({ type: 'percent', operator: 'equals', value: '50' }, '50.00')).toBe(true);
    });

    it('compares dates with TODAY in the user’s time zone', () => {
        const past = { type: 'date', operator: 'less_than', value: 'TODAY' };
        expect(one(past, '2026-06-15')).toBe(true);
        expect(one(past, '2026-09-28')).toBe(false);
        expect(one({ type: 'date', operator: 'less_or_equal', value: 'TODAY+7' }, '2026-10-05')).toBe(true);
        expect(one({ type: 'date', operator: 'equals', value: '1700-01-01' }, '1700-01-01')).toBe(true);
    });

    it('compares a date/time by its day in the user’s time zone', () => {
        const rule = { type: 'datetime', operator: 'equals', value: '2026-01-31' };
        expect(one(rule, '2026-01-31T23:30:00.000Z')).toBe(true);
        expect(one(rule, '2026-02-01T04:30:00.000Z')).toBe(true); // 04:30 UTC on 1 Feb is 23:30 on 31 Jan in New York
        expect(one(rule, '2026-02-01T05:30:00.000Z')).toBe(false); // and 05:30 UTC is 00:30 on 1 Feb
        expect(one(rule, 'TBD')).toBe(false);
    });

    it('compares times as HH:MM:SS', () => {
        expect(one({ type: 'time', operator: 'greater_than', value: '17:00:00' }, '17:30:00.000Z')).toBe(true);
        expect(one({ type: 'time', operator: 'greater_than', value: '17:00:00' }, '09:00:00.000Z')).toBe(false);
    });

    it('reads a checkbox as unchecked when it has no value', () => {
        const unchecked = { type: 'checkbox', operator: 'equals', value: 'false' };
        expect(one(unchecked, false)).toBe(true);
        expect(one(unchecked, null)).toBe(true);
        expect(one(unchecked, true)).toBe(false);
        expect(one({ type: 'checkbox', operator: 'equals', value: 'true' }, 'true')).toBe(true);
    });

    it('compares text and picklists without regard to case', () => {
        expect(one({ type: 'picklist', operator: 'equals', value: 'Express' }, 'express')).toBe(true);
        expect(one({ type: 'text', operator: 'contains', value: 'brick' }, 'Bangor Brick & Tile, Ltd.')).toBe(true);
        expect(one({ type: 'text', operator: 'starts_with', value: 'pro-10' }, 'PRO-1056')).toBe(true);
        expect(one({ type: 'text', operator: 'not_contains', value: 'reefer' }, 'Dry van, 12 pallets')).toBe(true);
        expect(
            one(
                { type: 'email', operator: 'contains', value: '@granitecoast' },
                'hannah.pelletier@GRANITECOASTFREIGHT.com'
            )
        ).toBe(true);
    });

    it('treats a multi-select as a set of values', () => {
        const has = { type: 'multipicklist', operator: 'contains', value: 'Liftgate' };
        expect(one(has, 'Fragile;Liftgate;Inside Delivery')).toBe(true);
        expect(one(has, 'Fragile;Inside Delivery')).toBe(false);
        expect(one(has, 'Liftgate Pickup')).toBe(false); // contains means includes that value, not the letters
        const same = { type: 'multipicklist', operator: 'equals', value: 'Fragile;Inside Delivery' };
        expect(one(same, 'Inside Delivery;Fragile')).toBe(true);
        expect(one(same, 'Fragile;Inside Delivery;Liftgate')).toBe(false);
        expect(one({ type: 'multipicklist', operator: 'not_contains', value: 'Liftgate' }, 'Fragile')).toBe(true);
    });

    it('compares lookups by record Id, 15 or 18 characters, and $User with the viewer', () => {
        const rule = { type: 'reference', operator: 'equals', value: '001000000000001AAA' };
        expect(one(rule, '001000000000001')).toBe(true);
        expect(one(rule, '001000000000002AAA')).toBe(false);
        const mine = { type: 'owner', operator: 'equals', value: '$User' };
        expect(one(mine, '005000000000001AAA')).toBe(true);
        expect(one(mine, '005000000000002AAA')).toBe(false);
        expect(one({ type: 'owner', operator: 'not_equals', value: '$User' }, '00G000000000001AAA')).toBe(true);
    });
});

describe('blank values', () => {
    it('meet is blank and the negative tests only (TC-001, TC-002)', () => {
        [null, undefined, ''].forEach(blank => {
            expect(one({ type: 'text', operator: 'is_blank' }, blank)).toBe(true);
            expect(one({ type: 'text', operator: 'is_not_blank' }, blank)).toBe(false);
            expect(one({ type: 'text', operator: 'equals', value: 'Bangor' }, blank)).toBe(false);
            expect(one({ type: 'text', operator: 'not_equals', value: 'Bangor' }, blank)).toBe(true);
            expect(one({ type: 'text', operator: 'not_contains', value: 'Bangor' }, blank)).toBe(true);
            expect(one({ type: 'number', operator: 'less_than', value: '0' }, blank)).toBe(false);
        });
    });

    it('never count zero as blank (TC-003)', () => {
        expect(one({ type: 'number', operator: 'is_blank' }, 0)).toBe(false);
        expect(one({ type: 'number', operator: 'equals', value: '0' }, '0.00')).toBe(true);
    });
});

describe('which classes a cell takes', () => {
    const RULES = [
        {
            name: 'Negative',
            label: 'Negative charge',
            field: 'Freight_Charge__c',
            type: 'currency',
            operator: 'less_than',
            value: '0',
            style: 'text_red',
            applyTo: 'cell'
        },
        {
            name: 'Large',
            label: 'Large charge',
            field: 'Freight_Charge__c',
            type: 'currency',
            operator: 'greater_or_equal',
            value: '1000',
            style: 'fill_green',
            applyTo: 'cell'
        },
        {
            name: 'Express',
            label: 'Express service',
            field: 'Service_Level__c',
            type: 'picklist',
            operator: 'equals',
            value: 'Express',
            style: 'fill_purple',
            applyTo: 'row'
        },
        {
            name: 'Late',
            field: 'Ship_Date__c',
            type: 'date',
            operator: 'less_than',
            value: 'TODAY',
            style: 'fill_red',
            applyTo: 'row'
        },
        {
            name: 'Heavy',
            label: 'Has a service level',
            field: 'Service_Level__c',
            type: 'picklist',
            operator: 'is_not_blank',
            style: 'bold',
            applyTo: 'row'
        }
    ];
    const FIELDS = ['Name', 'Freight_Charge__c', 'Service_Level__c', 'Ship_Date__c'];
    const compiled = compileRules(RULES, CONTEXT);
    const formats = row => formatsFor(compiled, f => row[f], FIELDS);

    it('gives nothing when no rule matches', () => {
        expect(formats({ Freight_Charge__c: '10', Service_Level__c: '', Ship_Date__c: '2027-01-01' })).toBeNull();
        expect(formatsFor([], f => f, FIELDS)).toBeNull();
    });

    it('formats only the rule’s own column for a cell rule, with its label', () => {
        expect(formats({ Freight_Charge__c: '-5', Service_Level__c: null, Ship_Date__c: null })).toEqual({
            cells: { Freight_Charge__c: STYLES.text_red.cls },
            labels: { Freight_Charge__c: 'Negative charge' },
            bar: null,
            rowLabels: [],
            icons: {},
            bars: {}
        });
    });

    it('marks a row fill with a bar, not a fill on every cell', () => {
        const f = formats({ Freight_Charge__c: '4999', Service_Level__c: 'Express', Ship_Date__c: null });
        expect(f.bar).toBe('rh-fmt_bar-purple');
        expect(f.cells.Name).toBe('rh-fmt_bold');
        expect(f.cells.Freight_Charge__c).toBe('rh-fmt_fill-green rh-fmt_bold'); // the cell fill still shows
        expect(f.cells.Service_Level__c).toBe('rh-fmt_bold');
        expect(f.labels).toEqual({ Freight_Charge__c: 'Large charge' });
        expect(f.rowLabels).toEqual(['Express service', 'Has a service level']);
    });

    it('takes the first row fill for the bar, and the first rule to set each thing on a cell', () => {
        const f = formats({ Freight_Charge__c: '-5', Service_Level__c: 'Express', Ship_Date__c: '2026-01-01' });
        expect(f.bar).toBe('rh-fmt_bar-purple'); // Express (earlier) beats Late
        expect(f.cells.Freight_Charge__c).toBe('rh-fmt_text-red rh-fmt_bold');
        expect(f.cells.Ship_Date__c).toBe('rh-fmt_bold');
        expect(f.rowLabels).toEqual(['Express service', 'Has a service level']); // Late lost the bar: not listed
    });

    it('returns a bar alone when only a row fill matches', () => {
        const only = compileRules([RULES[3]], CONTEXT);
        const f = formatsFor(only, field => ({ Ship_Date__c: '2026-01-01' })[field], FIELDS);
        expect(f).toEqual({ cells: {}, labels: {}, bar: 'rh-fmt_bar-red', rowLabels: ['Late'], icons: {}, bars: {} });
    });

    it('has no blue fill, because a blue row looks selected', () => {
        expect(compileRules([{ ...RULES[2], style: 'fill_blue' }], CONTEXT)).toEqual([]);
        const purple = compileRules([{ ...RULES[2], style: 'fill_purple' }], CONTEXT);
        expect(formatsFor(purple, f => ({ Service_Level__c: 'Express' })[f], FIELDS).bar).toBe('rh-fmt_bar-purple');
    });

    it('leaves out a rule with a style the grid does not know', () => {
        expect(
            compileRules([{ field: 'Consignee__c', type: 'text', operator: 'is_blank', style: 'mauve' }], CONTEXT)
        ).toEqual([]);
        expect(compileRules(undefined)).toEqual([]);
    });
});

describe('the Formatting legend', () => {
    it('lists each rule with its label and what it looks like', () => {
        const legend = legendFor([
            { name: 'Large', label: 'Large charge', field: 'Freight_Charge__c', style: 'fill_green', applyTo: 'cell' },
            { name: 'Express', field: 'Service_Level__c', style: 'fill_purple', applyTo: 'row' },
            { name: 'Heavy', label: 'Has a service level', field: 'Service_Level__c', style: 'bold', applyTo: 'row' },
            { name: 'Odd', field: 'Carrier_Code__c', style: 'mauve', applyTo: 'cell' }
        ]);
        expect(legend.map(l => [l.label, l.cls, l.bar, l.row])).toEqual([
            ['Large charge', 'rh-fmt_fill-green', null, false],
            ['Express', null, 'rh-fmt_bar-purple', true],
            ['Has a service level', 'rh-fmt_bold', null, true]
        ]);
        expect(legendFor(undefined)).toEqual([]);
    });
});
