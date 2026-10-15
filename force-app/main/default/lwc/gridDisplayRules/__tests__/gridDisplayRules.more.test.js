/**
 * The richer display rules: Between, two fields, formula rules, icons
 * and data bars, and how they sit beside the fills and text colors.
 */
import { compileRules, formatsFor, legendFor } from 'c/gridDisplayRules';

const CONTEXT = { today: '2026-09-28', timeZone: 'America/New_York', userId: '005000000000001AAA' };
const FIELDS = ['Name', 'Amount', 'Budget', 'Due'];
const compile = rules => compileRules(rules, CONTEXT);
const rowOf = values => field => values[field];

describe('between', () => {
    const test = (rule, value) =>
        compile([{ field: 'F', style: 'bold', applyTo: 'cell', operator: 'between', ...rule }])[0].test(value);

    it('includes both ends, for numbers, dates and times', () => {
        const n = { type: 'number', value: '10', valueTo: '20' };
        expect([9, 10, 15, 20, 21].map(v => test(n, v))).toEqual([false, true, true, true, false]);
        const d = { type: 'date', value: 'TODAY', valueTo: 'TODAY+7' };
        expect(['2026-09-27', '2026-09-28', '2026-10-05', '2026-10-06'].map(v => test(d, v))).toEqual([
            false,
            true,
            true,
            false
        ]);
        const t = { type: 'time', value: '09:00', valueTo: '17:00' };
        expect(['08:59:00.000Z', '09:00:00.000Z', '17:00:00.000Z', '17:01:00.000Z'].map(v => test(t, v))).toEqual([
            false,
            true,
            true,
            false
        ]);
    });

    it('never matches a blank, or a type with no order', () => {
        expect(test({ type: 'number', value: '1', valueTo: '9' }, null)).toBe(false);
        expect(test({ type: 'text', value: 'Augusta', valueTo: 'Portland' }, 'Bangor')).toBe(false);
    });
});

describe('two fields', () => {
    const rule = extra =>
        compile([
            {
                name: 'Over',
                label: 'Over budget',
                field: 'Amount',
                compareField: 'Budget',
                type: 'currency',
                style: 'text_red',
                applyTo: 'cell',
                ...extra
            }
        ]);

    it('compares a field with another of the same row', () => {
        const over = rule({ operator: 'greater_than' });
        expect(formatsFor(over, rowOf({ Amount: '120', Budget: '100' }), FIELDS).cells).toEqual({
            Amount: 'rh-fmt_text-red'
        });
        expect(formatsFor(over, rowOf({ Amount: '80', Budget: '100' }), FIELDS)).toBeNull();
        const same = rule({ operator: 'equals' });
        expect(formatsFor(same, rowOf({ Amount: '100.00', Budget: '100' }), FIELDS)).not.toBeNull();
    });

    it('meets only "does not equal" when one side is blank', () => {
        expect(
            formatsFor(rule({ operator: 'greater_than' }), rowOf({ Amount: '120', Budget: null }), FIELDS)
        ).toBeNull();
        expect(
            formatsFor(rule({ operator: 'not_equals' }), rowOf({ Amount: '120', Budget: null }), FIELDS)
        ).not.toBeNull();
        expect(formatsFor(rule({ operator: 'not_equals' }), rowOf({ Amount: null, Budget: null }), FIELDS)).toBeNull();
    });

    it('compares dates as dates', () => {
        const late = compile([
            {
                name: 'Late',
                field: 'Due',
                compareField: 'Closed',
                type: 'date',
                operator: 'less_than',
                style: 'fill_red',
                applyTo: 'cell'
            }
        ]);
        expect(formatsFor(late, rowOf({ Due: '2026-09-01', Closed: '2026-09-15' }), FIELDS).cells.Due).toBe(
            'rh-fmt_fill-red'
        );
        expect(formatsFor(late, rowOf({ Due: '2026-09-30', Closed: '2026-09-15' }), FIELDS)).toBeNull();
    });

    it('reads a date and a date/time each by its own type', () => {
        // 1 Oct 01:30 UTC is still 30 September in New York: the same day as the date.
        const sameDay = compile([
            {
                name: 'Same',
                field: 'Due',
                compareField: 'Closed',
                type: 'date',
                compareType: 'datetime',
                operator: 'equals',
                style: 'bold',
                applyTo: 'cell'
            }
        ]);
        expect(
            formatsFor(sameDay, rowOf({ Due: '2026-09-30', Closed: '2026-10-01T01:30:00.000Z' }), FIELDS)
        ).not.toBeNull();
        expect(
            formatsFor(sameDay, rowOf({ Due: '2026-10-01', Closed: '2026-10-01T01:30:00.000Z' }), FIELDS)
        ).toBeNull();
        const before = compile([
            {
                name: 'Before',
                field: 'Closed',
                compareField: 'Due',
                type: 'datetime',
                compareType: 'date',
                operator: 'less_than',
                style: 'bold',
                applyTo: 'cell'
            }
        ]);
        expect(
            formatsFor(before, rowOf({ Due: '2026-10-01', Closed: '2026-10-01T01:30:00.000Z' }), ['Closed', 'Due'])
        ).not.toBeNull();
    });

    it('compares two multi-select picklists as sets of values', () => {
        const same = compile([
            {
                name: 'Same',
                field: 'Due',
                compareField: 'Closed',
                type: 'multipicklist',
                compareType: 'multipicklist',
                operator: 'equals',
                style: 'bold',
                applyTo: 'cell'
            }
        ]);
        expect(formatsFor(same, rowOf({ Due: 'Fragile;Liftgate', Closed: 'liftgate;fragile' }), FIELDS)).not.toBeNull();
        expect(formatsFor(same, rowOf({ Due: 'Fragile;Liftgate', Closed: 'Fragile' }), FIELDS)).toBeNull();
        const differ = compile([
            {
                name: 'Differ',
                field: 'Due',
                compareField: 'Closed',
                type: 'multipicklist',
                compareType: 'multipicklist',
                operator: 'not_equals',
                style: 'bold',
                applyTo: 'cell'
            }
        ]);
        expect(formatsFor(differ, rowOf({ Due: 'Fragile;Liftgate', Closed: 'Liftgate;Fragile' }), FIELDS)).toBeNull();
    });
});

describe('formula rules', () => {
    const rules = compile([
        { name: 'Big_Deal', label: 'Big deal', isFormula: true, field: 'Amount', style: 'fill_green', applyTo: 'cell' },
        { name: 'Risky', label: 'Risky', isFormula: true, field: null, style: 'fill_amber', applyTo: 'row' }
    ]);

    it('meets the rows the server says meet it (_rules), whatever the cell shows', () => {
        const f = formatsFor(rules, rowOf({ Amount: '1', _rules: ['Big_Deal'] }), FIELDS);
        expect(f.cells).toEqual({ Amount: 'rh-fmt_fill-green' });
        expect(f.labels).toEqual({ Amount: 'Big deal' });
        expect(formatsFor(rules, rowOf({ Amount: '1' }), FIELDS)).toBeNull();
    });

    it('may color the whole row, with no field', () => {
        const f = formatsFor(rules, rowOf({ _rules: ['Risky'] }), FIELDS);
        expect(f.bar).toBe('rh-fmt_bar-amber');
        expect(f.rowLabels).toEqual(['Risky']);
    });
});

describe('icons and data bars', () => {
    const rules = compile([
        {
            name: 'Neg',
            label: 'Negative',
            field: 'Amount',
            type: 'currency',
            operator: 'less_than',
            value: '0',
            style: 'icon_warning',
            applyTo: 'cell'
        },
        {
            name: 'Credit_Alert',
            label: 'Credit alert',
            field: 'Amount',
            type: 'currency',
            operator: 'less_than',
            value: '0',
            style: 'icon_error',
            applyTo: 'cell'
        },
        {
            name: 'Size',
            label: 'Size',
            field: 'Amount',
            type: 'currency',
            operator: 'is_not_blank',
            style: 'data_bar',
            applyTo: 'cell'
        },
        {
            name: 'Credit',
            label: 'Credit balance',
            field: 'Amount',
            type: 'currency',
            operator: 'less_than',
            value: '0',
            style: 'fill_red',
            applyTo: 'cell'
        },
        {
            name: 'Rising',
            label: 'Rising',
            field: 'Amount',
            type: 'currency',
            operator: 'greater_than',
            value: '1000',
            style: 'icon_up',
            applyTo: 'row'
        }
    ]);

    it('puts the first matching icon before the cell, with the rule’s label, beside a fill and a bar', () => {
        const f = formatsFor(rules, rowOf({ Amount: '-5' }), FIELDS);
        expect(f.icons).toEqual({ Amount: { name: 'utility:warning', variant: 'warning', label: 'Negative' } });
        expect(f.bars).toEqual({ Amount: true });
        expect(f.cells).toEqual({ Amount: 'rh-fmt_fill-red' });
        expect(f.labels).toEqual({ Amount: 'Credit balance' });
    });

    it('puts a row rule’s icon on the row’s first column', () => {
        const f = formatsFor(rules, rowOf({ Amount: '5000' }), FIELDS);
        expect(f.icons).toEqual({ Name: { name: 'utility:arrowup', variant: null, label: 'Rising' } });
        expect(f.bars).toEqual({ Amount: true });
        expect(f.cells).toEqual({});
    });

    it('formats a row that only has a bar', () => {
        const bar = compile([
            {
                name: 'Size',
                field: 'Amount',
                type: 'currency',
                operator: 'is_not_blank',
                style: 'data_bar',
                applyTo: 'cell'
            }
        ]);
        expect(formatsFor(bar, rowOf({ Amount: '3' }), FIELDS)).toEqual({
            cells: {},
            labels: {},
            bar: null,
            rowLabels: [],
            icons: {},
            bars: { Amount: true }
        });
        expect(formatsFor(bar, rowOf({ Amount: null }), FIELDS)).toBeNull();
    });
});

describe('the Display Key', () => {
    it('lists icons with their icon, bars as bars, and formula rules', () => {
        const legend = legendFor([
            { name: 'Neg', label: 'Negative', field: 'Amount', style: 'icon_error', applyTo: 'cell' },
            { name: 'Size', label: 'Size', field: 'Amount', style: 'data_bar', applyTo: 'cell' },
            { name: 'Big', label: 'Big deal', isFormula: true, field: null, style: 'fill_green', applyTo: 'row' }
        ]);
        expect(legend.map(l => [l.label, l.kind, l.icon, l.variant, l.cls, l.bar, l.row])).toEqual([
            ['Negative', 'icon', 'utility:error', 'error', null, null, false],
            ['Size', 'databar', null, null, 'rh-fmt_databar', null, false],
            ['Big deal', 'fill', null, null, null, 'rh-fmt_bar-green', true]
        ]);
    });
});
