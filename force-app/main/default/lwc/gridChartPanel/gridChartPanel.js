/**
 * gridChartPanel — the chart beside a grid. At the top, the chart's title
 * ("Sum of Amount by Opportunity Owner") and how it is drawn ("Donut · kept
 * for you"), the gear and the close button. The gear's menu is a list
 * view's: Display as (each type, the one drawn checked), then Edit chart.
 * Under them the chart, of every record the grid's search and filters
 * match, as large as the panel lets it be: bars, plain or stacked (with a
 * key to the stacks' colours), or a donut with its total and count in the
 * middle and its groups under it. Pointing at a bar, a stack or a slice
 * shows what it is, its figure and its share of the total, as a list view's
 * tooltip does. At the foot, what it covers and "Show as a table", which
 * shows the figures in full, with their shares, in place of the drawing.
 *
 * Drawn in SVG from c/gridCharts (no chart library, HR-26), in the plot's
 * own size, measured after each render (HR-20) and followed with a
 * ResizeObserver where there is one (HR-23; the window's resize otherwise).
 * The drawing is hidden from screen readers, who read a table of the same
 * figures instead; the tooltip is for the pointer, and the table gives
 * keyboard users the same figures and shares.
 *
 * INPUTS (plain values, HR-28)
 *   chart        the chart (gridCharts normalizeChart)
 *   data         { status: 'loading' | 'ready' | 'error' | 'tooMany', groups, message }
 *   columns      the grid's columns
 *   names        lookup names the grid already knows, { recordId: name }
 *   objectLabel  the grid's object, plural ("Opportunities")
 * EVENTS OUT
 *   close, edit, display { type }
 */
import { LightningElement, api } from 'lwc';
import { formatCount } from 'c/gridFormat';
import {
    CHART_TYPES,
    MAX_NAMED,
    MAX_PERIODS,
    MAX_STACKS,
    chartTitle,
    chartSeries,
    chartTip,
    shareText,
    barLayout,
    donutLayout,
    donutTotalSize,
    isHorizontal
} from 'c/gridCharts';

/** How each type is named under the title and in Display as, as Edit chart's tiles name it. */
const TYPE_NAMES = Object.fromEntries(CHART_TYPES.map(t => [t.value, t.name]));
const MEASURE_HEADINGS = { count: 'Records', sum: 'Sum', average: 'Average' };
/** A date's periods, as the foot names them. */
const PERIODS = {
    day: 'days',
    week: 'weeks',
    month: 'months',
    quarter: 'quarters',
    year: 'years',
    fiscal_quarter: 'fiscal quarters',
    fiscal_year: 'fiscal years'
};

/** "Opportunities" → "opportunities"; a word in capitals ("SLA") stays as it is. */
function lowerNoun(label) {
    return String(label || '')
        .split(' ')
        .map(w => (/^[A-Z][a-z'’-]*$/.test(w) ? w.toLowerCase() : w))
        .join(' ');
}

/**
 * A name the narrow table may wrap after its slashes ("Negotiation/" then
 * "Review"), which browsers otherwise treat as part of one long word and split
 * mid-word. A zero-width space, which screen readers pass over.
 */
function wrappable(label) {
    return String(label == null ? '' : label).replace(/\/(?=\S)/g, '/​');
}

export default class GridChartPanel extends LightningElement {
    @api chart;
    @api data;
    @api columns;
    @api names;
    @api objectLabel;

    /** Show as a table: the figures in place of the drawing, for this visit. */
    showTable = false;
    /** The plot's size, measured: { width, height }; null until measured. */
    plotSize = null;
    /** The tooltip: { lines: [{ key, text }], style }, or null. */
    tip = null;

    // Non-reactive (HR-20).
    _memo = {};
    _layout = { frame: false, observer: null, observed: null, onResize: null };

    /** The gear: where focus goes back to after Edit chart or Display as. */
    @api
    focusMenu() {
        const gear = this.template.querySelector('.rh-charts-edit');
        if (gear && typeof gear.focus === 'function') gear.focus();
    }

    renderedCallback() {
        const plot = this.template.querySelector('.rh-charts-plot');
        const layout = this._layout;
        if (plot !== layout.observed) {
            if (layout.observer) layout.observer.disconnect();
            layout.observed = plot;
            if (plot && typeof ResizeObserver === 'function') {
                if (!layout.observer) layout.observer = new ResizeObserver(() => this.measureSoon());
                layout.observer.observe(plot);
            } else if (plot && !layout.onResize && typeof window !== 'undefined') {
                layout.onResize = () => this.measureSoon();
                window.addEventListener('resize', layout.onResize);
            }
        }
        if (plot) this.measureSoon();
    }

    disconnectedCallback() {
        const layout = this._layout;
        if (layout.observer) layout.observer.disconnect();
        if (layout.onResize) window.removeEventListener('resize', layout.onResize);
        layout.observer = null;
        layout.observed = null;
        layout.onResize = null;
    }

    /** Measure the plot in the next frame, once, and keep its size when it changed. */
    measureSoon() {
        const layout = this._layout;
        if (layout.frame) return;
        layout.frame = true;
        const measure = () => {
            layout.frame = false;
            const plot = this.template.querySelector('.rh-charts-plot');
            if (!plot) return;
            const width = Math.round(plot.clientWidth);
            const height = Math.round(plot.clientHeight);
            if (!width) return;
            const now = this.plotSize;
            if (!now || Math.abs(now.width - width) > 2 || Math.abs(now.height - height) > 2) {
                this.plotSize = { width, height };
            }
        };
        if (typeof requestAnimationFrame === 'function') {
            // eslint-disable-next-line @lwc/lwc/no-async-operation -- measure after the browser lays the panel out (HR-20)
            requestAnimationFrame(measure);
        } else measure();
    }

    get title() {
        return chartTitle(this.chart, this.columns);
    }

    get subtitle() {
        const type = this.chart && TYPE_NAMES[this.chart.type];
        return type ? `${type} · kept for you` : '';
    }

    /** The gear's Display as: every type, the one drawn checked. */
    get typeItems() {
        const now = this.chart && this.chart.type;
        return CHART_TYPES.map(t => ({ value: t.value, label: t.name, checked: t.value === now }));
    }

    get status() {
        return (this.data && this.data.status) || 'loading';
    }

    get loading() {
        return this.status === 'loading';
    }

    /** The figures, worked out once per answer and chart. */
    get series() {
        const m = this._memo;
        if (m.data === this.data && m.chart === this.chart && m.columns === this.columns) return m.series;
        m.data = this.data;
        m.chart = this.chart;
        m.columns = this.columns;
        m.series =
            this.status === 'ready' && this.chart
                ? chartSeries((this.data && this.data.groups) || [], this.chart, this.columns, { names: this.names })
                : null;
        return m.series;
    }

    get entries() {
        return this.series
            ? this.series.entries.map(e => ({ ...e, swatchClass: 'rh-charts-swatch ' + e.colorClass }))
            : [];
    }

    get message() {
        if (this.loading) return '';
        if (this.status === 'error') {
            return 'The chart could not be drawn. ' + ((this.data && this.data.message) || '');
        }
        if (this.status === 'tooMany') {
            return 'There are too many groups to chart. Group by another column, or a date by a longer period.';
        }
        if (!this.entries.length) return 'There are no records to chart.';
        return '';
    }

    get drawn() {
        return !this.message && !this.loading && Boolean(this.chart);
    }

    get showHbar() {
        return this.drawn && !this.showTable && isHorizontal(this.chart.type);
    }

    get showVbar() {
        return this.drawn && !this.showTable && (this.chart.type === 'vbar' || this.chart.type === 'svbar');
    }

    get showDonut() {
        return this.drawn && !this.showTable && this.chart.type === 'donut';
    }

    get stacked() {
        return Boolean(this.series && this.series.stacked);
    }

    get showStackKey() {
        return this.drawn && !this.showTable && this.stacked;
    }

    get stacks() {
        return this.series
            ? this.series.stacks.map(st => ({ ...st, swatchClass: 'rh-charts-swatch ' + st.colorClass }))
            : [];
    }

    get bars() {
        return barLayout(this.entries, isHorizontal(this.chart.type), this.plotSize, { stacked: this.stacked });
    }

    get barsViewBox() {
        const b = this.bars;
        return `0 0 ${b.width} ${b.height}`;
    }

    /** The drawing at the size it was laid out for, so its text stays the size it was set. */
    get barsStyle() {
        const b = this.bars;
        return `width: ${b.width}px; height: ${b.height}px`;
    }

    get donut() {
        return donutLayout(this.entries, this.plotSize);
    }

    get donutViewBox() {
        const d = this.donut;
        return `0 0 ${d.size} ${d.size}`;
    }

    get donutStyle() {
        const d = this.donut;
        return `width: ${d.size}px; height: ${d.size}px`;
    }

    get donutRotate() {
        const c = this.donut.center;
        return `rotate(-90 ${c} ${c})`;
    }

    get donutTotalY() {
        return this.donut.center - 2;
    }

    get donutCountY() {
        return this.donut.center + Math.round(16 * (this.donut.size / 150));
    }

    get totalShort() {
        return this.series ? this.series.total.short : '';
    }

    /** A longer total ("USD 105.2K") is set smaller, to fit inside the ring; a larger donut, larger. */
    get donutTotalStyle() {
        return `font-size: ${donutTotalSize(this.totalShort, this.donut.size)}px`;
    }

    get totalText() {
        return this.series ? this.series.total.text : '';
    }

    get recordCount() {
        return this.series ? this.series.total.count : 0;
    }

    /** "31 opportunities"; one is "1 record", as the object's own name is plural. */
    get countText() {
        const n = this.recordCount;
        const noun = n === 1 ? 'record' : lowerNoun(this.objectLabel) || 'records';
        return `${formatCount(n)} ${noun}`;
    }

    /** The count in a donut's middle: "records" when the object's name would not fit there. */
    get donutCountText() {
        const text = this.countText;
        if (text.length <= 17) return text;
        const n = this.recordCount;
        return `${formatCount(n)} ${n === 1 ? 'record' : 'records'}`;
    }

    get groupHeading() {
        const c = (this.columns || []).find(col => this.chart && col.field === this.chart.groupBy);
        return (c && (c.label || c.field)) || 'Group';
    }

    get valueHeading() {
        if (!this.chart) return '';
        if (this.chart.measure === 'count') return MEASURE_HEADINGS.count;
        const c = (this.columns || []).find(col => col.field === this.chart.field);
        return `${MEASURE_HEADINGS[this.chart.measure] || ''} of ${(c && (c.label || c.field)) || this.chart.field}`;
    }

    /** A share for each figure, as the tooltip gives it: for a count or a sum, not an average. */
    get hasShare() {
        return Boolean(this.chart) && this.chart.measure !== 'average';
    }

    /**
     * The table's rows: each group, and under a stacked bar's group each of
     * its stacks, indented; with the share of the total.
     */
    get tableRows() {
        if (!this.series) return [];
        const total = this.series.total.value;
        const rows = [];
        this.series.entries.forEach(e => {
            rows.push({
                key: 'g:' + e.key,
                label: wrappable(e.label),
                spoken: e.label,
                text: e.text,
                share: shareText(e.value, total, this.chart),
                rowClass: this.stacked ? 'rh-charts-grid-group' : ''
            });
            (e.segments || []).forEach(seg => {
                rows.push({
                    key: 's:' + e.key + ':' + seg.key,
                    label: wrappable(seg.label),
                    spoken: `${e.label}, ${seg.label}`,
                    text: seg.text,
                    share: shareText(seg.value, total, this.chart),
                    rowClass: 'rh-charts-grid-stack'
                });
            });
        });
        return rows;
    }

    get footText() {
        if (!this.series || !this.drawn) return '';
        let text = `All ${this.countText} the search and filters match, as saved.`;
        if (this.series.dated) {
            const periods = PERIODS[this.chart.unit] || 'periods';
            text += ` The last ${MAX_PERIODS} ${periods}; the ones before go in Earlier.`;
        } else {
            const what = this.chart.type === 'donut' ? 'slices' : 'bars';
            text += ` Up to ${MAX_NAMED + 1} ${what}; the rest go in Other.`;
        }
        if (this.stacked) {
            text += this.series.stacksDated
                ? ` Stacks: the last ${MAX_STACKS} ${PERIODS[this.chart.stackUnit] || 'periods'}; the ones before go in Earlier.`
                : ` Up to ${MAX_STACKS + 1} stacks in each; the rest go in Other.`;
        }
        if (this.chart.type === 'donut' && this.series.hasNegative) {
            text += ' The donut leaves out groups below zero; the list has them.';
        }
        return text;
    }

    get toggleLabel() {
        return this.showTable ? 'Show as a chart' : 'Show as a table';
    }

    handleToggleTable() {
        this.showTable = !this.showTable;
    }

    /** The gear's menu: a type to draw the chart as, or Edit chart. */
    handleMenuSelect(event) {
        const value = event.detail && event.detail.value;
        if (value === 'edit') {
            this.dispatchEvent(new CustomEvent('edit'));
            return;
        }
        if (TYPE_NAMES[value] && (!this.chart || value !== this.chart.type)) {
            this.dispatchEvent(new CustomEvent('display', { detail: { type: value } }));
        }
    }

    /**
     * The tooltip, while the pointer is over a bar, a stack or a slice: what
     * it is, its figure and its share, beside the pointer and inside the plot.
     */
    handleTip(event) {
        const target = event.target;
        const entry = target && target.dataset ? target.dataset.entry : undefined;
        if (entry === undefined || entry === null || entry === '') {
            if (this.tip) this.tip = null;
            return;
        }
        const segment = target.dataset.segment;
        const lines = chartTip(
            this.series,
            this.chart,
            this.columns,
            Number(entry),
            segment === undefined || segment === null || segment === '' ? null : Number(segment)
        );
        if (!lines.length) return;
        const plot = this.template.querySelector('.rh-charts-plot');
        const box = plot ? plot.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
        const width = box.width || 0;
        const x = Math.round(event.clientX - box.left);
        const y = Math.round(event.clientY - box.top);
        // Slid along the pointer as far as the pointer is across the plot: its
        // left edge at the pointer on the plot's left, its right edge at the
        // pointer on the right. No narrower than the plot, it never leaves it.
        const across = width ? Math.round((Math.min(Math.max(x, 0), width) / width) * 100) : 0;
        // Below the pointer near the top, where above would leave the plot.
        const below = y < 70;
        this.tip = {
            lines: lines.map((text, i) => ({ key: String(i), text })),
            style: `left: ${x}px; top: ${y}px; transform: translate(-${across}%, ${below ? '16px' : 'calc(-100% - 10px)'})`
        };
    }

    handleTipOut() {
        this.tip = null;
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }
}
