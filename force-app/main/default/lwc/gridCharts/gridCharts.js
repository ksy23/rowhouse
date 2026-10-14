/**
 * gridCharts — what a grid's chart shows, as plain functions over plain
 * objects, no DOM (HR-28).
 *
 * THE CHART A USER KEEPS
 * As a list view's chart: { type, measure, field, groupBy, unit }.
 *   type      vbar, hbar or donut: Vertical Bar Chart, Horizontal Bar Chart,
 *             Donut Chart
 *   measure   count (the records), sum or average (of `field`)
 *   field     a number, currency or percent column; null for count
 *   groupBy   a column the grid can group by
 *   unit      for a date or date/time column, as grouping has it (month when
 *             none); null otherwise
 * It is kept with the user's layout, and checked against the grid's columns
 * as it is read back (normalizeChart): a column the grid no longer has, or
 * can no longer group by or add up, is left out.
 *
 * THE FIGURES
 * The server answers as it does for a grouping (GridController.chartGroups,
 * sliced on a large list); chartSeries adds the slices up (rollUp) into one
 * figure per group. Groups come largest first, as a list view's chart lists
 * them, with every group after the ninth in Other; a date's periods come in
 * order, with every period before the last twenty-four in Earlier. A sum of
 * money is in the corporate currency, as the Total row's is.
 *
 * THE DRAWING
 * barLayout and donutLayout give the shapes, in a fixed coordinate space the
 * panel scales to its width: no chart library (HR-26).
 */
import LOCALE from '@salesforce/i18n/locale';
import CURRENCY from '@salesforce/i18n/currency';
import {
    rollUp,
    groupLabel,
    subtotalFor,
    addDecimal,
    isDateColumn,
    levelParam,
    DATE_UNITS,
    UNIT_LABELS
} from 'c/gridGroups';
import { formatCount } from 'c/gridFormat';

export const CHART_TYPES = [
    { value: 'vbar', label: 'Vertical Bar Chart' },
    { value: 'hbar', label: 'Horizontal Bar Chart' },
    { value: 'donut', label: 'Donut Chart' }
];
/** In a list view's order. */
export const MEASURES = [
    { value: 'average', label: 'Average' },
    { value: 'sum', label: 'Sum' },
    { value: 'count', label: 'Count' }
];
/** Groups named before the rest go in Other. */
export const MAX_NAMED = 9;
/** A date's periods shown before the earlier ones go in Earlier. */
export const MAX_PERIODS = 24;
export const OTHER_KEY = '__other';
/** Colours in turn; Other is always the last, gray. */
export const COLOR_COUNT = 10;

const NUMBER_TYPES = new Set(['number', 'currency', 'percent', 'double', 'integer', 'long']);

/** Columns a chart can group by. */
export function groupByColumns(columns) {
    return (Array.isArray(columns) ? columns : []).filter(c => c && c.groupable === true);
}

/** Columns a chart can add up or average: a field of a number type, read from the server. */
export function measureColumns(columns) {
    return (Array.isArray(columns) ? columns : []).filter(
        c => c && NUMBER_TYPES.has(c.type) && !c.isFormula && !c.isChildTotal && !c.encrypted
    );
}

/** A kept chart, checked against the columns; null when it no longer fits. */
export function normalizeChart(chart, columns) {
    if (!chart || typeof chart !== 'object' || Array.isArray(chart)) return null;
    const group = groupByColumns(columns).find(c => c.field === chart.groupBy);
    if (!group) return null;
    const type = CHART_TYPES.some(t => t.value === chart.type) ? chart.type : 'hbar';
    let measure = MEASURES.some(m => m.value === chart.measure) ? chart.measure : 'count';
    let field = null;
    if (measure !== 'count') {
        const m = measureColumns(columns).find(c => c.field === chart.field);
        if (m) field = m.field;
        else measure = 'count';
    }
    const unit = isDateColumn(group) ? (DATE_UNITS.includes(chart.unit) ? chart.unit : 'month') : null;
    return { type, measure, field, groupBy: group.field, unit };
}

/**
 * The chart a user starts with: the records counted by the grid's first
 * grouping, or else by its first picklist, or else by the first column it can
 * group by; as horizontal bars, a list view's first choice. Null when the grid
 * has nothing to group by.
 */
export function defaultChart(columns, grouping) {
    const groupable = groupByColumns(columns);
    if (!groupable.length) return null;
    const level = Array.isArray(grouping) && grouping.length ? grouping[0] : null;
    const byGrouping = level ? groupable.find(c => c.field === level.field) : null;
    const pick = byGrouping || groupable.find(c => c.type === 'picklist') || groupable[0];
    return normalizeChart(
        { type: 'hbar', measure: 'count', groupBy: pick.field, unit: byGrouping ? level.unit : null },
        columns
    );
}

/** What the server is asked to group by: "Field__c", or "Field__c:month". */
export function chartParam(chart) {
    return levelParam({ field: chart.groupBy, unit: chart.unit });
}

/** "Sum of Amount by Stage", "Record Count by Close Date (Month)". */
export function chartTitle(chart, columns) {
    if (!chart) return '';
    const byField = new Map((Array.isArray(columns) ? columns : []).map(c => [c.field, c]));
    const group = byField.get(chart.groupBy);
    const by = `${(group && group.label) || chart.groupBy}${chart.unit ? ` (${UNIT_LABELS[chart.unit] || chart.unit})` : ''}`;
    if (chart.measure === 'count') return `Record Count by ${by}`;
    const m = byField.get(chart.field);
    const name = (m && m.label) || chart.field;
    return chart.measure === 'sum' ? `Sum of ${name} by ${by}` : `Average ${name} by ${by}`;
}

let monthShort;
/** "Sep 2026": a month short enough to stand under a bar. */
function shortMonth(key) {
    if (!monthShort) monthShort = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return monthShort.format(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1));
}

let compactFormat;
/** "5.9M", "410K", "12": a figure short enough for a bar or the donut's middle. */
export function shortNumber(value) {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '';
    if (!compactFormat)
        compactFormat = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
    return compactFormat.format(n);
}

const compactCurrency = new Map();

/**
 * A figure shortened for a bar, a donut's middle or its list: an amount with
 * its currency ("$3.6M"), a percent with its sign ("82.3%"), else as
 * shortNumber. In an org with more than one currency a chart's figures are
 * in the corporate currency, as the Total row's are, and shown by its code
 * ("USD 105.2K"); the number alone when that currency could not be read. The
 * table keeps every figure in full.
 */
export function shortFigure(value, column) {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '';
    const type = column && column.type;
    if (type === 'currency') {
        const multi = Boolean(column.currencyField || column.currencyCode);
        const code = multi ? column.totalCurrency : CURRENCY;
        if (!code) return shortNumber(n);
        const key = code + (multi ? ':code' : '');
        try {
            if (!compactCurrency.has(key)) {
                compactCurrency.set(
                    key,
                    new Intl.NumberFormat(LOCALE, {
                        style: 'currency',
                        currency: code,
                        currencyDisplay: multi ? 'code' : 'symbol',
                        notation: 'compact',
                        maximumFractionDigits: 1
                    })
                );
            }
            return compactCurrency.get(key).format(n);
        } catch {
            // A currency code the browser does not know: the number alone.
            return shortNumber(n);
        }
    }
    return type === 'percent' ? shortNumber(n) + '%' : shortNumber(n);
}

/** One aggregate's figure: { value: number or null, text }. */
function figure(aggregate, measureColumn) {
    if (!measureColumn) {
        const n = Number(aggregate.count) || 0;
        return { value: n, text: formatCount(n) };
    }
    const sub = subtotalFor(aggregate, measureColumn);
    const value = sub && sub.value !== null && sub.value !== undefined && sub.value !== '' ? Number(sub.value) : null;
    return { value: Number.isFinite(value) ? value : null, text: sub ? sub.text : '' };
}

/** Several aggregates as one: counts add, sums add exactly, an average is their sum over their count. */
function combined(aggregates, field) {
    const out = { count: 0, values: {} };
    let s = null;
    let c = 0;
    aggregates.forEach(a => {
        out.count += Number(a.count) || 0;
        const v = field && a.values ? a.values[field] : null;
        if (v) {
            s = addDecimal(s, v.s);
            c += Number(v.c) || 0;
        }
    });
    if (field) out.values[field] = { s, c, mn: null, mx: null };
    return out;
}

/**
 * The chart's figures from the server's groups (every slice):
 * { entries: [{ key, label, value, text, short, colorClass, isOther }],
 *   total: { value, text, short, count }, hasNegative, dated }.
 * `names` labels lookups the grid already knows; the server's label comes
 * first.
 */
export function chartSeries(groups, chart, columns, { names } = {}) {
    const cols = Array.isArray(columns) ? columns : [];
    const byField = new Map(cols.map(c => [c.field, c]));
    const groupColumn = byField.get(chart.groupBy) || { field: chart.groupBy, type: 'text' };
    const measureColumn =
        chart.measure === 'count' ? null : { ...(byField.get(chart.field) || {}), subtotal: chart.measure };
    const { byPath, total } = rollUp(groups, [{ field: chart.groupBy, unit: chart.unit }], cols);
    const dated = isDateColumn(groupColumn);
    let items = [...byPath.entries()].map(([key, aggregate]) => ({
        key,
        aggregate,
        label: groupLabel(key, groupColumn, chart.unit, { names, serverLabel: aggregate.label || undefined }),
        ...figure(aggregate, measureColumn)
    }));
    if (dated) {
        // Periods in order, blank last; the earliest beyond MAX_PERIODS together.
        items.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        const periods = items.filter(i => i.key !== '');
        if (periods.length > MAX_PERIODS) {
            const cut = periods.length - MAX_PERIODS;
            const earlier = periods.slice(0, cut);
            const agg = combined(
                earlier.map(i => i.aggregate),
                measureColumn && measureColumn.field
            );
            items = [
                { key: OTHER_KEY, label: 'Earlier', isOther: true, aggregate: agg, ...figure(agg, measureColumn) },
                ...items.slice(cut)
            ];
        }
    } else {
        // Largest first, as a list view's chart lists them; the rest in Other.
        items.sort((a, b) => (b.value || 0) - (a.value || 0) || a.label.localeCompare(b.label, LOCALE));
        if (items.length > MAX_NAMED + 1) {
            const rest = items.slice(MAX_NAMED);
            const agg = combined(
                rest.map(i => i.aggregate),
                measureColumn && measureColumn.field
            );
            items = [
                ...items.slice(0, MAX_NAMED),
                { key: OTHER_KEY, label: 'Other', isOther: true, aggregate: agg, ...figure(agg, measureColumn) }
            ];
        }
    }
    let colour = 0;
    const byMonth = dated && chart.unit === 'month';
    const entries = items.map(i => ({
        key: i.key,
        label: i.label,
        // Under a bar, a month is short ("Sep 2026"); the list and the table say it in full.
        axisLabel: byMonth && !i.isOther && i.key !== '' ? shortMonth(i.key) : i.label,
        value: i.value,
        text: i.text,
        short: shortFigure(i.value, measureColumn),
        isOther: i.isOther === true,
        colorClass: `rh-chart-c${i.isOther ? COLOR_COUNT : colour++ % COLOR_COUNT}`
    }));
    const t = figure(total, measureColumn);
    return {
        entries,
        total: { ...t, short: shortFigure(t.value, measureColumn), count: total.count },
        hasNegative: entries.some(e => e.value !== null && e.value < 0),
        dated
    };
}

// ------------------------------------------------------------------ drawing

/** A round scale from lo to hi with about `count` steps: { lo, hi, ticks: [numbers] }. */
export function niceScale(min, max, count = 4) {
    let lo = Math.min(0, Number(min) || 0);
    let hi = Math.max(0, Number(max) || 0);
    if (hi === lo) hi = lo + 1;
    const rough = (hi - lo) / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / magnitude;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
    return { lo, hi, ticks };
}

/** A label cut to `max` characters, with an ellipsis. */
export function clip(text, max) {
    const t = String(text || '');
    return t.length > max ? t.slice(0, Math.max(1, max - 1)) + '…' : t;
}

const round = n => Math.round(n * 10) / 10;
const barColour = e => (e.isOther ? `rh-chart-c${COLOR_COUNT}` : 'rh-chart-bar');

/** The panel's drawing width: the panel scales it to fit. */
export const CHART_WIDTH = 300;

/**
 * Bars, horizontal or vertical: { width, height, bars, ticks, baseline }.
 * A bar: { key, x, y, w, h, label, labelX, labelY, value, valueX, valueY,
 * colorClass }. Negative figures go the other way from zero. Every bar is one
 * colour, as a list view's are, and Other or Earlier gray.
 */
export function barLayout(entries, horizontal) {
    const list = entries || [];
    const values = list.map(e => (e.value === null ? 0 : e.value));
    const scale = niceScale(Math.min(0, ...values), Math.max(0, ...values));
    const span = scale.hi - scale.lo;
    if (horizontal) {
        const left = 104;
        const right = CHART_WIDTH - 40;
        const rowH = 26;
        const top = 4;
        const height = top + list.length * rowH + 22;
        const x = v => left + ((v - scale.lo) / span) * (right - left);
        const zero = x(0);
        const bars = list.map((e, i) => {
            const v = values[i];
            const end = x(v);
            const y = top + i * rowH + 4;
            return {
                key: e.key,
                x: round(Math.min(zero, end)),
                y,
                w: round(Math.max(1, Math.abs(end - zero))),
                h: 18,
                label: clip(e.axisLabel || e.label, 16),
                labelX: left - 6,
                labelY: y + 13,
                value: e.short,
                valueX: round(Math.max(zero, end) + 4),
                valueY: y + 13,
                colorClass: barColour(e)
            };
        });
        const axisY = top + list.length * rowH + 4;
        return {
            width: CHART_WIDTH,
            height,
            horizontal: true,
            bars,
            baseline: { x1: round(zero), y1: top, x2: round(zero), y2: axisY },
            ticks: scale.ticks.map(t => ({ key: String(t), x: round(x(t)), y: axisY + 14, text: shortNumber(t) }))
        };
    }
    // Room on the left for the first slanted label, which runs down and left.
    const left = 52;
    const right = CHART_WIDTH - 6;
    const top = 16;
    const bottom = 150;
    const height = 220;
    const y = v => bottom - ((v - scale.lo) / span) * (bottom - top);
    const zero = y(0);
    const slot = list.length ? (right - left) / list.length : 0;
    const barW = Math.max(4, Math.min(36, slot * 0.7));
    const bars = list.map((e, i) => {
        const v = values[i];
        const end = y(v);
        const cx = left + slot * i + slot / 2;
        return {
            key: e.key,
            x: round(cx - barW / 2),
            y: round(Math.min(zero, end)),
            w: round(barW),
            h: round(Math.max(1, Math.abs(end - zero))),
            label: clip(e.axisLabel || e.label, 12),
            labelX: round(cx),
            labelY: bottom + 12,
            labelTransform: `rotate(-40 ${round(cx)} ${bottom + 12})`,
            value: e.short,
            valueX: round(cx),
            valueY: round(Math.min(zero, end) - 4),
            colorClass: barColour(e)
        };
    });
    return {
        width: CHART_WIDTH,
        height,
        horizontal: false,
        bars,
        baseline: { x1: left, y1: round(zero), x2: right, y2: round(zero) },
        ticks: scale.ticks.map(t => ({ key: String(t), x: left - 4, y: round(y(t) + 3), text: shortNumber(t) }))
    };
}

/**
 * A donut: { size, center, radius, stroke, circumference, segments }. Each
 * segment is a ring drawn with a dash: { key, dash, offset, colorClass }.
 * Only positive figures have a share; a donut cannot show a negative one.
 */
export function donutLayout(entries) {
    // As drawn in the mock-up: a ring 22 wide, leaving room in the middle for
    // the total and the count.
    const size = 150;
    const radius = 60;
    const stroke = 22;
    const circumference = 2 * Math.PI * radius;
    const list = (entries || []).filter(e => e.value !== null && e.value > 0);
    const sum = list.reduce((a, e) => a + e.value, 0);
    let at = 0;
    const segments = sum
        ? list.map(e => {
              const length = (e.value / sum) * circumference;
              const seg = {
                  key: e.key,
                  dash: `${round(length)} ${round(circumference - length)}`,
                  offset: round(-at),
                  colorClass: e.colorClass
              };
              at += length;
              return seg;
          })
        : [];
    return { size, center: size / 2, radius, stroke, circumference: round(circumference), segments };
}
