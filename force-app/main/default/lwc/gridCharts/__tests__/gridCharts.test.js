/**
 * What a grid's chart shows: the chart a user keeps, checked against the
 * columns; its title; its figures from the server's groups, largest first
 * with the rest in Other, or a date's periods in order; and the shapes of
 * bars and a donut.
 */
import {
    normalizeChart,
    defaultChart,
    chartParam,
    chartTitle,
    chartSeries,
    niceScale,
    barLayout,
    donutLayout,
    shortNumber,
    clip,
    measureColumns,
    groupByColumns,
    MAX_NAMED,
    MAX_PERIODS,
    OTHER_KEY
} from 'c/gridCharts';

const STAGES = ['Prospecting', 'Qualification', 'Needs Analysis', 'Proposal/Price Quote', 'Closed Won'];
const COLUMNS = [
    { field: 'Name', label: 'Opportunity Name', type: 'text', groupable: false },
    {
        field: 'StageName',
        label: 'Stage',
        type: 'picklist',
        groupable: true,
        options: STAGES.map(s => ({ value: s, label: s }))
    },
    { field: 'Amount', label: 'Amount', type: 'currency', scale: 2, groupable: true },
    { field: 'CloseDate', label: 'Close Date', type: 'date', groupable: true },
    { field: 'OwnerId', label: 'Opportunity Owner', type: 'owner', groupable: true },
    { field: '_fx_Margin', label: 'Margin', type: 'currency', isFormula: true },
    { field: 'Probability', label: 'Probability (%)', type: 'percent', groupable: false },
    { field: 'Discount__c', label: 'Discount', type: 'number', encrypted: true }
];

const g = (key, n, v = {}) => ({ k: [key], l: [''], n, v });

describe('the chart a user keeps', () => {
    it('keeps a chart that fits the columns', () => {
        expect(
            normalizeChart({ type: 'donut', measure: 'sum', field: 'Amount', groupBy: 'StageName' }, COLUMNS)
        ).toEqual({ type: 'donut', measure: 'sum', field: 'Amount', groupBy: 'StageName', unit: null });
    });

    it('gives a date a unit, month when it has none', () => {
        expect(normalizeChart({ type: 'vbar', measure: 'count', groupBy: 'CloseDate' }, COLUMNS).unit).toBe('month');
        expect(
            normalizeChart({ type: 'vbar', measure: 'count', groupBy: 'CloseDate', unit: 'fiscal_quarter' }, COLUMNS)
                .unit
        ).toBe('fiscal_quarter');
    });

    it('counts instead of adding up a column that cannot be added up, and draws bars when the type is unknown', () => {
        ['Name', '_fx_Margin', 'Discount__c', 'Gone__c', null].forEach(field => {
            expect(normalizeChart({ type: 'pie', measure: 'sum', field, groupBy: 'StageName' }, COLUMNS)).toEqual({
                type: 'hbar',
                measure: 'count',
                field: null,
                groupBy: 'StageName',
                unit: null
            });
        });
    });

    it('keeps nothing when the grid can no longer group by its column', () => {
        expect(normalizeChart({ type: 'hbar', measure: 'count', groupBy: 'Name' }, COLUMNS)).toBeNull();
        expect(normalizeChart({ type: 'hbar', measure: 'count', groupBy: 'Gone__c' }, COLUMNS)).toBeNull();
        expect(normalizeChart(null, COLUMNS)).toBeNull();
        expect(normalizeChart([], COLUMNS)).toBeNull();
    });

    it('offers the columns a chart can group by, and the number columns it can add up', () => {
        expect(groupByColumns(COLUMNS).map(c => c.field)).toEqual(['StageName', 'Amount', 'CloseDate', 'OwnerId']);
        expect(measureColumns(COLUMNS).map(c => c.field)).toEqual(['Amount', 'Probability']);
    });

    it("starts with the records counted by the grid's grouping, else by its first picklist", () => {
        expect(defaultChart(COLUMNS, [{ field: 'CloseDate', unit: 'quarter' }])).toEqual({
            type: 'hbar',
            measure: 'count',
            field: null,
            groupBy: 'CloseDate',
            unit: 'quarter'
        });
        expect(defaultChart(COLUMNS, [])).toEqual(
            expect.objectContaining({ groupBy: 'StageName', measure: 'count', type: 'hbar' })
        );
        expect(defaultChart([{ field: 'Name', type: 'text' }], [])).toBeNull();
    });

    it('asks the server to group as a grouping level is asked', () => {
        expect(chartParam({ groupBy: 'CloseDate', unit: 'quarter' })).toBe('CloseDate:quarter');
        expect(chartParam({ groupBy: 'StageName', unit: null })).toBe('StageName');
    });

    it('names what it shows', () => {
        expect(chartTitle({ measure: 'count', groupBy: 'StageName' }, COLUMNS)).toBe('Record Count by Stage');
        expect(chartTitle({ measure: 'sum', field: 'Amount', groupBy: 'StageName' }, COLUMNS)).toBe(
            'Sum of Amount by Stage'
        );
        expect(chartTitle({ measure: 'average', field: 'Amount', groupBy: 'CloseDate', unit: 'month' }, COLUMNS)).toBe(
            'Average Amount by Close Date (Month)'
        );
    });
});

describe('the figures', () => {
    const count = { type: 'hbar', measure: 'count', field: null, groupBy: 'StageName', unit: null };
    const sum = { ...count, measure: 'sum', field: 'Amount' };
    const average = { ...count, measure: 'average', field: 'Amount' };

    it('counts each group, largest first, labelled as the picklist labels its values', () => {
        const series = chartSeries([g('Prospecting', 2), g('Closed Won', 5), g('Qualification', 3)], count, COLUMNS);
        expect(series.entries.map(e => [e.label, e.value, e.text])).toEqual([
            ['Closed Won', 5, '5'],
            ['Qualification', 3, '3'],
            ['Prospecting', 2, '2']
        ]);
        expect(series.total).toEqual(expect.objectContaining({ value: 10, text: '10', count: 10 }));
        expect(series.entries.map(e => e.colorClass)).toEqual(['rh-chart-c0', 'rh-chart-c1', 'rh-chart-c2']);
    });

    it('adds up the slices of a large list exactly, and formats the sums as the grid does', () => {
        const series = chartSeries(
            [
                g('Closed Won', 2, { Amount: { s: '0.10', c: 2 } }),
                g('Closed Won', 1, { Amount: { s: '0.20', c: 1 } }),
                g('Prospecting', 1, { Amount: { s: '1200', c: 1 } })
            ],
            sum,
            COLUMNS
        );
        expect(series.entries.map(e => [e.label, e.value])).toEqual([
            ['Prospecting', 1200],
            ['Closed Won', 0.3]
        ]);
        expect(series.entries[0].text).toMatch(/1,200\.00/);
        expect(series.total.value).toBe(1200.3);
    });

    it('averages as the sum over the count', () => {
        const series = chartSeries(
            [g('Closed Won', 3, { Amount: { s: '300', c: 3 } }), g('Prospecting', 2, { Amount: { s: '50', c: 1 } })],
            average,
            COLUMNS
        );
        expect(series.entries.map(e => [e.label, e.value])).toEqual([
            ['Closed Won', 100],
            ['Prospecting', 50]
        ]);
        expect(series.total.value).toBe(87.5);
    });

    it(`names the ${MAX_NAMED} largest groups and puts the rest in Other`, () => {
        const groups = Array.from({ length: 12 }, (_, i) =>
            g(`Stage ${String(i + 1).padStart(2, '0')}`, 12 - i, { Amount: { s: String((12 - i) * 10), c: 12 - i } })
        );
        const counted = chartSeries(groups, count, COLUMNS);
        expect(counted.entries).toHaveLength(MAX_NAMED + 1);
        const other = counted.entries[MAX_NAMED];
        expect(other).toEqual(expect.objectContaining({ key: OTHER_KEY, label: 'Other', isOther: true, value: 6 }));
        expect(other.colorClass).toBe('rh-chart-c10');
        // An average in Other is the others' sums over their counts, not an average of averages.
        const averaged = chartSeries(groups, average, COLUMNS);
        expect(averaged.entries[MAX_NAMED].value).toBe(10);
    });

    it(`keeps a date's periods in order, the ${MAX_PERIODS} latest named and the ones before in Earlier`, () => {
        const months = Array.from({ length: 30 }, (_, i) => {
            const year = 2024 + Math.floor(i / 12);
            return g(`${year}-${String((i % 12) + 1).padStart(2, '0')}`, i + 1);
        });
        const series = chartSeries(
            [...months].reverse().concat([g('', 4)]),
            { type: 'vbar', measure: 'count', field: null, groupBy: 'CloseDate', unit: 'month' },
            COLUMNS
        );
        expect(series.entries).toHaveLength(MAX_PERIODS + 2);
        expect(series.entries[0]).toEqual(expect.objectContaining({ label: 'Earlier', value: 21 }));
        expect(series.entries[1].label).toBe('July 2024');
        expect(series.entries[MAX_PERIODS].label).toBe('June 2026');
        expect(series.entries[MAX_PERIODS + 1].label).toBe('(blank)');
    });

    it('labels a lookup by the name the server sends', () => {
        const series = chartSeries(
            [{ k: ['005000000000077AAA'], l: ['Nora Pelletier'], n: 3, v: {} }],
            { ...count, groupBy: 'OwnerId' },
            COLUMNS
        );
        expect(series.entries[0].label).toBe('Nora Pelletier');
    });

    it('says when a figure is below zero', () => {
        const series = chartSeries(
            [g('Closed Won', 1, { Amount: { s: '-40', c: 1 } }), g('Prospecting', 1, { Amount: { s: '60', c: 1 } })],
            sum,
            COLUMNS
        );
        expect(series.hasNegative).toBe(true);
    });
});

describe('the drawing', () => {
    it('chooses a round scale that holds every figure', () => {
        expect(niceScale(0, 1215000)).toEqual({ lo: 0, hi: 1500000, ticks: [0, 500000, 1000000, 1500000] });
        expect(niceScale(-40, 60).lo).toBeLessThan(0);
        expect(niceScale(0, 0)).toEqual(expect.objectContaining({ lo: 0, hi: 1 }));
    });

    it('draws horizontal bars in proportion, a negative one to the left of zero', () => {
        const layout = barLayout(
            [
                { key: 'a', label: 'Closed Won', value: 100, short: '100', colorClass: 'rh-chart-c0' },
                { key: 'b', label: 'Prospecting', value: 50, short: '50', colorClass: 'rh-chart-c1' },
                { key: 'c', label: 'Qualification', value: -25, short: '-25', colorClass: 'rh-chart-c2' }
            ],
            true
        );
        const [a, b, c] = layout.bars;
        expect(Math.round(a.w / b.w)).toBe(2);
        expect(c.x + c.w).toBeCloseTo(layout.baseline.x1, 0);
        expect(a.x).toBeCloseTo(layout.baseline.x1, 0);
        expect(a.label).toBe('Closed Won');
    });

    it('draws every bar in one colour, Other in gray, as a list view does', () => {
        const layout = barLayout(
            [
                { key: 'a', label: 'Closed Won', value: 3, colorClass: 'rh-chart-c0' },
                { key: 'b', label: 'Prospecting', value: 2, colorClass: 'rh-chart-c1' },
                { key: OTHER_KEY, label: 'Other', value: 1, isOther: true, colorClass: 'rh-chart-c10' }
            ],
            true
        );
        expect(layout.bars.map(b => b.colorClass)).toEqual(['rh-chart-c0', 'rh-chart-c0', 'rh-chart-c10']);
    });

    it('shortens a month under a bar, and keeps it in full in the list', () => {
        const series = chartSeries(
            [g('2026-09', 2)],
            { type: 'vbar', measure: 'count', field: null, groupBy: 'CloseDate', unit: 'month' },
            COLUMNS
        );
        expect(series.entries[0].label).toBe('September 2026');
        expect(barLayout(series.entries, false).bars[0].label).toBe('Sep 2026');
    });

    it('draws vertical bars with their labels turned, cut when long', () => {
        const layout = barLayout(
            [{ key: 'a', label: 'Proposal/Price Quote', value: 10, short: '10', colorClass: 'rh-chart-c0' }],
            false
        );
        expect(layout.bars[0].label).toBe('Proposal/Pr…');
        expect(layout.bars[0].labelTransform).toMatch(/^rotate\(-40 /);
        expect(clip('Short', 12)).toBe('Short');
    });

    it('leaves the first turned label room on the left, with ten bars', () => {
        const entries = Array.from({ length: 10 }, (_, i) => ({
            key: String(i),
            label: 'Negotiation/Review',
            value: 10 - i,
            short: String(10 - i),
            colorClass: 'rh-chart-c0'
        }));
        // Twelve characters, turned 40 degrees, reach about 50 units to the left.
        expect(barLayout(entries, false).bars[0].labelX).toBeGreaterThanOrEqual(60);
    });

    it('draws a donut whose slices go once round, leaving out a figure below zero', () => {
        const donut = donutLayout([
            { key: 'a', value: 3, colorClass: 'rh-chart-c0' },
            { key: 'b', value: 1, colorClass: 'rh-chart-c1' },
            { key: 'c', value: -2, colorClass: 'rh-chart-c2' }
        ]);
        expect(donut.segments.map(s => s.key)).toEqual(['a', 'b']);
        const lengths = donut.segments.map(s => Number(s.dash.split(' ')[0]));
        expect(lengths[0] + lengths[1]).toBeCloseTo(donut.circumference, 0);
        expect(donut.segments[1].offset).toBeCloseTo(-lengths[0], 0);
    });

    it('shortens a figure for a bar or the middle of a donut', () => {
        expect(shortNumber(5900000)).toBe('5.9M');
        expect(shortNumber(410000)).toBe('410K');
        expect(shortNumber(12)).toBe('12');
        expect(shortNumber(null)).toBe('');
    });
});
