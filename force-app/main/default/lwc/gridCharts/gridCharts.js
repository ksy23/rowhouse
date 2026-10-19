/**
 * gridCharts — what a grid's chart shows, as plain functions over plain
 * objects, no DOM (HR-28).
 *
 * THE CHART A USER KEEPS
 * As a list view's chart: { type, measure, field, groupBy, unit }, and for
 * stacked bars { stackBy, stackUnit }.
 *   type      vbar, hbar, svbar, shbar or donut: Vertical Bar Chart,
 *             Horizontal Bar Chart, the two stacked, as a report's are, and
 *             Donut Chart
 *   measure   count (the records), sum or average (of `field`)
 *   field     a number, currency or percent column; null for count
 *   groupBy   a column the grid can group by
 *   unit      for a date or date/time column, as grouping has it (month when
 *             none); null otherwise
 *   stackBy   for stacked bars, a second column the grid can group by, whose
 *             groups stack within each bar; stackUnit as unit. Kept when the
 *             type changes, so stacked bars can come back. Stacked bars add
 *             up: they count or sum, never average.
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
 * money is in the corporate currency, as the Total row's is. Stacked, each
 * bar's stacks are the second column's groups, the six largest over the
 * whole chart named and the rest in Other.
 *
 * THE DRAWING
 * barLayout and donutLayout give the shapes, in the panel's own size, so the
 * chart fills it: no chart library (HR-26). chartTip says what a bar, a
 * stack or a slice is, for the tooltip.
 */
import LOCALE from '@salesforce/i18n/locale';
import CURRENCY from '@salesforce/i18n/currency';
import {
    rollUp,
    groupLabel,
    subtotalFor,
    addDecimal,
    isDateColumn,
    PATH_SEP,
    levelParam,
    DATE_UNITS,
    UNIT_LABELS
} from 'c/gridGroups';
import { formatCount } from 'c/gridFormat';

export const CHART_TYPES = [
    { value: 'vbar', label: 'Vertical Bar Chart', name: 'Vertical bar' },
    { value: 'hbar', label: 'Horizontal Bar Chart', name: 'Horizontal bar' },
    { value: 'svbar', label: 'Stacked Vertical Bar Chart', name: 'Stacked vertical bar' },
    { value: 'shbar', label: 'Stacked Horizontal Bar Chart', name: 'Stacked horizontal bar' },
    { value: 'donut', label: 'Donut Chart', name: 'Donut' }
];
/** Stacked bars, and the plain bars each is drawn as without a stack. */
const UNSTACKED = { svbar: 'vbar', shbar: 'hbar' };

/** Bars that stack a second column's groups. */
export function isStacked(type) {
    return Object.prototype.hasOwnProperty.call(UNSTACKED, type);
}

/** Bars that run across. */
export function isHorizontal(type) {
    return type === 'hbar' || type === 'shbar';
}
/** In a list view's order. */
export const MEASURES = [
    { value: 'average', label: 'Average' },
    { value: 'sum', label: 'Sum' },
    { value: 'count', label: 'Count' }
];
/** Groups named before the rest go in Other. */
export const MAX_NAMED = 9;
/** Stacks named in each bar before the rest go in Other. */
export const MAX_STACKS = 6;
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
    const out = { type, measure, field, groupBy: group.field, unit };
    const stack = chart.stackBy
        ? groupByColumns(columns).find(c => c.field === chart.stackBy && c.field !== group.field)
        : null;
    if (stack) {
        out.stackBy = stack.field;
        out.stackUnit = isDateColumn(stack) ? (DATE_UNITS.includes(chart.stackUnit) ? chart.stackUnit : 'month') : null;
    }
    // Stacked bars need a second column, and add up: without one, or averaged, they are plain bars.
    if (isStacked(type) && (!stack || measure === 'average')) out.type = UNSTACKED[type];
    return out;
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

/** What the server is asked to stack by, for stacked bars; null otherwise. */
export function stackParam(chart) {
    return chart && isStacked(chart.type) && chart.stackBy
        ? levelParam({ field: chart.stackBy, unit: chart.stackUnit })
        : null;
}

/** "Sum of Amount by Stage", "Record Count by Close Date (Month)", "… by Stage and Owner". */
export function chartTitle(chart, columns) {
    if (!chart) return '';
    const byField = new Map((Array.isArray(columns) ? columns : []).map(c => [c.field, c]));
    const named = (field, unit) => {
        const c = byField.get(field);
        return `${(c && c.label) || field}${unit ? ` (${UNIT_LABELS[unit] || unit})` : ''}`;
    };
    let by = named(chart.groupBy, chart.unit);
    if (stackParam(chart)) by += ` and ${named(chart.stackBy, chart.stackUnit)}`;
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
 * Groups as a chart lists them: largest first with the rest in Other, or a
 * date's periods in order with the earliest in Earlier. Each item keeps the
 * keys it stands for (`members`), so a stack can be found for Other too.
 */
function ordered(items, dated, measureColumn, limit, periodLimit = MAX_PERIODS) {
    if (dated) {
        // Periods in order, blank last; the earliest beyond the limit together.
        items.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        const periods = items.filter(i => i.key !== '');
        if (periods.length > periodLimit) {
            const cut = periods.length - periodLimit;
            return [together(items.slice(0, cut), 'Earlier', measureColumn), ...items.slice(cut)];
        }
        return items;
    }
    // Largest first, as a list view's chart lists them; the rest in Other.
    items.sort((a, b) => (b.value || 0) - (a.value || 0) || a.label.localeCompare(b.label, LOCALE));
    if (items.length > limit + 1) {
        return [...items.slice(0, limit), together(items.slice(limit), 'Other', measureColumn)];
    }
    return items;
}

/** Several groups as one (Other, Earlier). */
function together(items, label, measureColumn) {
    const agg = combined(
        items.map(i => i.aggregate),
        measureColumn && measureColumn.field
    );
    return {
        key: OTHER_KEY,
        label,
        isOther: true,
        aggregate: agg,
        members: items.flatMap(i => i.members),
        ...figure(agg, measureColumn)
    };
}

/**
 * The chart's figures from the server's groups (every slice):
 * { entries: [{ key, label, value, text, short, colorClass, isOther,
 *   segments }], total: { value, text, short, count }, hasNegative, dated,
 *   stacked, stacksDated, stacks }. `names` labels lookups the grid already knows; the
 * server's label comes first. Stacked, each entry's `segments` are its
 * stacks ([{ key, label, value, text, short, colorClass }], in `stacks`'
 * order), and `stacks` are the second column's groups, the largest first.
 */
export function chartSeries(groups, chart, columns, { names } = {}) {
    const cols = Array.isArray(columns) ? columns : [];
    const byField = new Map(cols.map(c => [c.field, c]));
    const groupColumn = byField.get(chart.groupBy) || { field: chart.groupBy, type: 'text' };
    const measureColumn =
        chart.measure === 'count' ? null : { ...(byField.get(chart.field) || {}), subtotal: chart.measure };
    const stacked = Boolean(stackParam(chart));
    const stackColumn = stacked ? byField.get(chart.stackBy) || { field: chart.stackBy, type: 'text' } : null;
    const levels = [{ field: chart.groupBy, unit: chart.unit }];
    if (stacked) levels.push({ field: chart.stackBy, unit: chart.stackUnit });
    const { byPath, total } = rollUp(groups, levels, cols);
    const dated = isDateColumn(groupColumn);
    const firsts = [];
    const seconds = new Map(); // a stack's key -> { aggregates, label }
    byPath.forEach((aggregate, path) => {
        const at = path.indexOf(PATH_SEP);
        if (at < 0) {
            firsts.push({
                key: path,
                members: [path],
                aggregate,
                label: groupLabel(path, groupColumn, chart.unit, { names, serverLabel: aggregate.label || undefined }),
                ...figure(aggregate, measureColumn)
            });
            return;
        }
        const key = path.slice(at + 1);
        let s = seconds.get(key);
        if (!s) {
            s = { aggregates: [], label: aggregate.label || undefined };
            seconds.set(key, s);
        }
        s.aggregates.push(aggregate);
        if (!s.label && aggregate.label) s.label = aggregate.label;
    });
    const items = ordered(firsts, dated, measureColumn, MAX_NAMED);

    // The stacks: the second column's groups over the whole chart, largest first, the rest in
    // Other; a date's latest periods, as many, the ones before in Earlier.
    let stacks = [];
    if (stacked) {
        const all = [...seconds.entries()].map(([key, s]) => {
            const agg = combined(s.aggregates, measureColumn && measureColumn.field);
            return {
                key,
                members: [key],
                aggregate: agg,
                label: groupLabel(key, stackColumn, chart.stackUnit, { names, serverLabel: s.label }),
                ...figure(agg, measureColumn)
            };
        });
        let shade = 0;
        stacks = ordered(all, isDateColumn(stackColumn), measureColumn, MAX_STACKS, MAX_STACKS).map(st => ({
            key: st.key,
            label: st.label,
            members: st.members,
            isOther: st.isOther === true,
            colorClass: `rh-chart-c${st.isOther ? COLOR_COUNT : shade++ % COLOR_COUNT}`
        }));
    }

    let colour = 0;
    const byMonth = dated && chart.unit === 'month';
    const entries = items.map(i => {
        const entry = {
            key: i.key,
            label: i.label,
            // Under a bar, a month is short ("Sep 2026"); the list and the table say it in full.
            axisLabel: byMonth && !i.isOther && i.key !== '' ? shortMonth(i.key) : i.label,
            value: i.value,
            text: i.text,
            short: shortFigure(i.value, measureColumn),
            isOther: i.isOther === true,
            colorClass: `rh-chart-c${i.isOther ? COLOR_COUNT : colour++ % COLOR_COUNT}`
        };
        if (stacked) {
            entry.segments = stacks
                .map(st => {
                    const aggs = [];
                    i.members.forEach(k1 =>
                        st.members.forEach(k2 => {
                            const a = byPath.get(k1 + PATH_SEP + k2);
                            if (a) aggs.push(a);
                        })
                    );
                    if (!aggs.length) return null;
                    const f = figure(combined(aggs, measureColumn && measureColumn.field), measureColumn);
                    return {
                        key: st.key,
                        label: st.label,
                        value: f.value,
                        text: f.text,
                        short: shortFigure(f.value, measureColumn),
                        colorClass: st.colorClass
                    };
                })
                .filter(Boolean);
        }
        return entry;
    });
    const t = figure(total, measureColumn);
    return {
        entries,
        total: { ...t, short: shortFigure(t.value, measureColumn), count: total.count },
        hasNegative: entries.some(e => e.value !== null && e.value < 0),
        dated,
        stacked,
        stacksDated: stacked && isDateColumn(stackColumn),
        stacks: stacks.map(({ key, label, isOther, colorClass }) => ({ key, label, isOther, colorClass }))
    };
}

const percentFormat = new Map();
/** "63.3%": a share of the total. */
function percentText(share) {
    if (!percentFormat.has(LOCALE)) {
        percentFormat.set(LOCALE, new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 }));
    }
    return percentFormat.get(LOCALE).format(share);
}

/**
 * A figure's share of the chart's total, "63.3%", for a count or a sum of
 * figures that are not below zero; '' for an average, which has no share.
 */
export function shareText(value, total, chart) {
    if (!chart || chart.measure === 'average') return '';
    const v = Number(value);
    const t = Number(total);
    if (!Number.isFinite(v) || !Number.isFinite(t) || t <= 0 || v < 0) return '';
    return percentText(v / t);
}

/**
 * What a bar, a stack or a slice is, for the tooltip, as a list view's
 * says it: [line], such as ["Stage: Closed Won", "Owner: Ana Ruiz",
 * "Sum of Amount: $2,260,000.00", "39.2% of $5,760,000.00"].
 */
export function chartTip(series, chart, columns, entryIndex, segmentIndex) {
    if (!series || !chart) return [];
    const entry = series.entries[entryIndex];
    if (!entry) return [];
    const byField = new Map((Array.isArray(columns) ? columns : []).map(c => [c.field, c]));
    const labelOf = field => {
        const c = byField.get(field);
        return (c && c.label) || field;
    };
    const lines = [`${labelOf(chart.groupBy)}: ${entry.label}`];
    const seg = segmentIndex === null || segmentIndex === undefined ? null : (entry.segments || [])[segmentIndex];
    if (seg) lines.push(`${labelOf(chart.stackBy)}: ${seg.label}`);
    const measure =
        chart.measure === 'count'
            ? 'Record Count'
            : `${chart.measure === 'sum' ? 'Sum of' : 'Average'} ${labelOf(chart.field)}`;
    const it = seg || entry;
    lines.push(`${measure}: ${it.text}`);
    const share = shareText(it.value, series.total.value, chart);
    if (share) lines.push(`${share} of ${series.total.text}`);
    return lines;
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
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** The drawing's width when the panel's is not known yet. */
export const CHART_WIDTH = 300;
/** Vertical bars' height when the panel's is not known yet. */
export const CHART_HEIGHT = 220;

/**
 * A bar's pieces, from zero: one for a plain bar; for stacked bars one per
 * stack, the ones above zero stacked up (or right) and any below stacked down
 * (or left). [{ from, to, colorClass, segment }] in figures.
 */
function pieces(e, stacked) {
    if (!stacked) {
        const v = e.value === null ? 0 : e.value;
        return [{ from: 0, to: v, colorClass: barColour(e), segment: null }];
    }
    let up = 0;
    let down = 0;
    return (e.segments || []).map((s, i) => {
        const v = s.value === null ? 0 : s.value;
        const from = v < 0 ? down : up;
        const to = from + v;
        if (v < 0) down = to;
        else up = to;
        return { from, to, colorClass: s.colorClass, segment: i };
    });
}

/**
 * Bars, horizontal or vertical, plain or stacked, in the size the panel
 * gives (`size` { width, height }; the drawing's own when not given):
 * { width, height, bars, ticks, baseline }. A bar: { key, x, y, w, h, label,
 * labelX, labelY, value, valueX, valueY, colorClass, segs }, where `segs`
 * are its rectangles ({ key, x, y, w, h, colorClass, entry, segment }: one
 * for a plain bar, one per stack). Negative figures go the other way from
 * zero. Plain bars are one colour, as a list view's are, and Other or
 * Earlier gray; stacks take their own colours.
 */
export function barLayout(entries, horizontal, size, { stacked = false } = {}) {
    const list = entries || [];
    const parts = list.map(e => pieces(e, stacked));
    const ends = parts.flatMap(p => p.map(q => q.to));
    const scale = niceScale(Math.min(0, ...ends), Math.max(0, ...ends));
    const span = scale.hi - scale.lo;
    const width = Math.max(200, Math.round((size && size.width) || CHART_WIDTH));
    if (horizontal) {
        // Labels take up to a third of the width; rows share the height, within reason.
        const left = Math.round(clamp(width * 0.34, 90, 150));
        const right = width - 40;
        const top = 4;
        const room = size && size.height ? size.height - top - 26 : list.length * 26;
        const rowH = list.length ? Math.round(clamp(room / list.length, 22, 60)) : 26;
        const barH = Math.round(rowH * 0.66);
        const height = top + list.length * rowH + 22;
        const x = v => left + ((v - scale.lo) / span) * (right - left);
        const zero = x(0);
        const chars = Math.max(8, Math.floor((left - 10) / 6.4));
        const bars = list.map((e, i) => {
            const y = top + i * rowH + Math.round((rowH - barH) / 2);
            const lo = Math.min(0, ...parts[i].map(q => Math.min(q.from, q.to)));
            const hi = Math.max(0, ...parts[i].map(q => Math.max(q.from, q.to)));
            const segs = parts[i].map((q, j) => ({
                key: `${e.key}:${j}`,
                x: round(Math.min(x(q.from), x(q.to))),
                y,
                w: round(Math.max(1, Math.abs(x(q.to) - x(q.from)))),
                h: barH,
                colorClass: q.colorClass,
                entry: i,
                segment: q.segment
            }));
            return {
                key: e.key,
                x: round(x(lo)),
                y,
                w: round(Math.max(1, x(hi) - x(lo))),
                h: barH,
                label: clip(e.axisLabel || e.label, chars),
                labelX: left - 6,
                labelY: y + Math.round(barH / 2) + 4,
                value: e.short,
                valueX: round(x(hi) + 4),
                valueY: y + Math.round(barH / 2) + 4,
                colorClass: stacked ? 'rh-chart-bar' : barColour(e),
                segs
            };
        });
        const axisY = top + list.length * rowH;
        return {
            width,
            height,
            horizontal: true,
            bars,
            baseline: { x1: round(zero), y1: top, x2: round(zero), y2: axisY },
            ticks: scale.ticks.map(t => ({ key: String(t), x: round(x(t)), y: axisY + 14, text: shortNumber(t) }))
        };
    }
    // Room on the left for the first slanted label, which runs down and left.
    const height = Math.round(clamp((size && size.height) || CHART_HEIGHT, 180, 640));
    const left = 52;
    const right = width - 6;
    const top = 16;
    const bottom = height - 70;
    const y = v => bottom - ((v - scale.lo) / span) * (bottom - top);
    const zero = y(0);
    const slot = list.length ? (right - left) / list.length : 0;
    const barW = Math.max(4, Math.min(48, slot * 0.7));
    const bars = list.map((e, i) => {
        const cx = left + slot * i + slot / 2;
        const lo = Math.min(0, ...parts[i].map(q => Math.min(q.from, q.to)));
        const hi = Math.max(0, ...parts[i].map(q => Math.max(q.from, q.to)));
        const segs = parts[i].map((q, j) => ({
            key: `${e.key}:${j}`,
            x: round(cx - barW / 2),
            y: round(Math.min(y(q.from), y(q.to))),
            w: round(barW),
            h: round(Math.max(1, Math.abs(y(q.to) - y(q.from)))),
            colorClass: q.colorClass,
            entry: i,
            segment: q.segment
        }));
        return {
            key: e.key,
            x: round(cx - barW / 2),
            y: round(y(hi)),
            w: round(barW),
            h: round(Math.max(1, y(lo) - y(hi))),
            label: clip(e.axisLabel || e.label, 12),
            labelX: round(cx),
            labelY: bottom + 12,
            labelTransform: `rotate(-40 ${round(cx)} ${bottom + 12})`,
            value: e.short,
            valueX: round(cx),
            valueY: round(y(hi) - 4),
            colorClass: stacked ? 'rh-chart-bar' : barColour(e),
            segs
        };
    });
    return {
        width,
        height,
        horizontal: false,
        bars,
        baseline: { x1: left, y1: round(zero), x2: right, y2: round(zero) },
        ticks: scale.ticks.map(t => ({ key: String(t), x: left - 4, y: round(y(t) + 3), text: shortNumber(t) }))
    };
}

/**
 * The font size, in pixels, of the total in a donut's middle, so that it fits
 * inside the ring: 18 for a short figure such as "$105.2K" in the drawing's
 * own size (150), smaller for a longer one such as "USD 105.2K" in an org
 * with more than one currency; larger in a larger donut, up to 26.
 */
export function donutTotalSize(text, size = 150) {
    const scale = size / 150;
    const length = String(text || '').length;
    const most = Math.min(26, Math.floor(18 * scale));
    if (!length) return most;
    // The hole is 98 across at 150 (donutLayout: radius 60 less half the 22
    // ring); the total keeps 6 clear on each side, and a bold figure or letter
    // is about 0.58 of the font size wide.
    return Math.max(11, Math.min(most, Math.floor((86 * scale) / (length * 0.58))));
}

/**
 * A donut, as wide as the panel lets it be (`size` { width }; 150 when not
 * given, at most 240): { size, center, radius, stroke, circumference,
 * segments }. Each segment is a ring drawn with a dash: { key, dash, offset,
 * colorClass, entry }. Only positive figures have a share; a donut cannot
 * show a negative one.
 */
export function donutLayout(entries, size) {
    // As drawn in the mock-up: a ring 22 wide at 150, leaving room in the
    // middle for the total and the count.
    const side = size && size.width ? Math.round(clamp(size.width - 24, 150, 240)) : 150;
    const radius = round(side * 0.4);
    const stroke = round(side * (22 / 150));
    const circumference = 2 * Math.PI * radius;
    const all = entries || [];
    const list = all.filter(e => e.value !== null && e.value > 0);
    const sum = list.reduce((a, e) => a + e.value, 0);
    let at = 0;
    const segments = sum
        ? list.map(e => {
              const length = (e.value / sum) * circumference;
              const seg = {
                  key: e.key,
                  dash: `${round(length)} ${round(circumference - length)}`,
                  offset: round(-at),
                  colorClass: e.colorClass,
                  entry: all.indexOf(e)
              };
              at += length;
              return seg;
          })
        : [];
    return { size: side, center: side / 2, radius, stroke, circumference: round(circumference), segments };
}
