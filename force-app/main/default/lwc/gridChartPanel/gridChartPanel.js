/**
 * gridChartPanel — the chart beside a grid. At the top, the chart's title
 * ("Sum of Amount by Opportunity Owner") and how it is drawn ("Donut · kept
 * for you"), the gear (Edit chart) and the close button; under them the
 * chart, of every record the grid's search and filters match: bars, or a
 * donut with its total and count in the middle and its groups beside it; at
 * the foot, what it covers and "Show as a table", which shows the figures in
 * full in place of the drawing.
 *
 * Drawn in SVG from c/gridCharts (no chart library, HR-26). The drawing is
 * hidden from screen readers, who read a table of the same figures instead.
 *
 * INPUTS (plain values, HR-28)
 *   chart        the chart (gridCharts normalizeChart)
 *   data         { status: 'loading' | 'ready' | 'error' | 'tooMany', groups, message }
 *   columns      the grid's columns
 *   names        lookup names the grid already knows, { recordId: name }
 *   objectLabel  the grid's object, plural ("Opportunities")
 * EVENTS OUT
 *   close, edit
 */
import { LightningElement, api } from 'lwc';
import { formatCount } from 'c/gridFormat';
import { MAX_NAMED, MAX_PERIODS, chartTitle, chartSeries, barLayout, donutLayout } from 'c/gridCharts';

/** How each type is named under the title, as Edit chart's tiles name it. */
const TYPE_NAMES = { vbar: 'Vertical bar', hbar: 'Horizontal bar', donut: 'Donut' };
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

export default class GridChartPanel extends LightningElement {
    @api chart;
    @api data;
    @api columns;
    @api names;
    @api objectLabel;

    /** Show as a table: the figures in place of the drawing, for this visit. */
    showTable = false;

    // Non-reactive (HR-20).
    _memo = {};

    /** The gear: where focus goes back to after Edit chart. */
    @api
    focusMenu() {
        const gear = this.template.querySelector('.rh-charts-edit');
        if (gear && typeof gear.focus === 'function') gear.focus();
    }

    get title() {
        return chartTitle(this.chart, this.columns);
    }

    get subtitle() {
        const type = this.chart && TYPE_NAMES[this.chart.type];
        return type ? `${type} · kept for you` : '';
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
        return this.drawn && !this.showTable && this.chart.type === 'hbar';
    }

    get showVbar() {
        return this.drawn && !this.showTable && this.chart.type === 'vbar';
    }

    get showDonut() {
        return this.drawn && !this.showTable && this.chart.type === 'donut';
    }

    get bars() {
        return barLayout(this.entries, this.chart.type === 'hbar');
    }

    get barsViewBox() {
        const b = this.bars;
        return `0 0 ${b.width} ${b.height}`;
    }

    get donut() {
        return donutLayout(this.entries);
    }

    get donutViewBox() {
        const d = this.donut;
        return `0 0 ${d.size} ${d.size}`;
    }

    get donutRotate() {
        const c = this.donut.center;
        return `rotate(-90 ${c} ${c})`;
    }

    get donutTotalY() {
        return this.donut.center - 2;
    }

    get donutCountY() {
        return this.donut.center + 16;
    }

    get totalShort() {
        return this.series ? this.series.total.short : '';
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

    handleEdit() {
        this.dispatchEvent(new CustomEvent('edit'));
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }
}
