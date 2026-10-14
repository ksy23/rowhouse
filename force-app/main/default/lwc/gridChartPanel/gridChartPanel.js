/**
 * gridChartPanel — the Charts panel beside a grid, as a list view's: the
 * chart's title, a gear whose menu says how it is drawn (Display As: Vertical
 * Bar Chart, Horizontal Bar Chart, Donut Chart) and opens Edit Chart, and the
 * chart itself, of every record the grid's search and filters match.
 *
 * Drawn in SVG from c/gridCharts (no chart library, HR-26). The drawing is
 * hidden from screen readers, who read a table of the same figures instead;
 * a donut lists its groups and their figures under it, as Salesforce's does.
 *
 * INPUTS (plain values, HR-28)
 *   chart     the chart (gridCharts normalizeChart)
 *   data      { status: 'loading' | 'ready' | 'error' | 'tooMany', groups, message }
 *   columns   the grid's columns
 *   names     lookup names the grid already knows, { recordId: name }
 * EVENTS OUT
 *   close, type { type }, edit
 */
import { LightningElement, api } from 'lwc';
import { formatCount } from 'c/gridFormat';
import { CHART_TYPES, chartTitle, chartSeries, barLayout, donutLayout } from 'c/gridCharts';

export default class GridChartPanel extends LightningElement {
    @api chart;
    @api data;
    @api columns;
    @api names;

    // Non-reactive (HR-20).
    _memo = {};

    /** The gear: where focus goes back to after Edit Chart. */
    @api
    focusMenu() {
        const menu = this.template.querySelector('.rh-charts-menu');
        if (menu && typeof menu.focus === 'function') menu.focus();
    }

    get title() {
        return chartTitle(this.chart, this.columns);
    }

    get typeItems() {
        const type = this.chart && this.chart.type;
        return CHART_TYPES.map(t => ({ ...t, checked: t.value === type }));
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
        return this.series ? this.series.entries : [];
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

    get isHbar() {
        return this.drawn && this.chart.type === 'hbar';
    }

    get isVbar() {
        return this.drawn && this.chart.type === 'vbar';
    }

    get isDonut() {
        return this.drawn && this.chart.type === 'donut';
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

    get totalShort() {
        return this.series ? this.series.total.short : '';
    }

    get totalText() {
        return this.series ? this.series.total.text : '';
    }

    get totalLabel() {
        if (!this.chart) return '';
        return this.chart.measure === 'count' ? 'records' : this.chart.measure === 'sum' ? 'in all' : 'on average';
    }

    get footText() {
        if (!this.series) return '';
        const n = this.series.total.count;
        let text = `All ${formatCount(n)} ${n === 1 ? 'record' : 'records'} the search and filters match, as saved.`;
        if (this.chart.type === 'donut' && this.series.hasNegative) {
            text += ' The donut leaves out groups below zero; the list has them.';
        }
        return text;
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    handleMenu(event) {
        const value = event.detail && event.detail.value;
        if (value === 'edit') this.dispatchEvent(new CustomEvent('edit'));
        else if (CHART_TYPES.some(t => t.value === value))
            this.dispatchEvent(new CustomEvent('type', { detail: { type: value } }));
    }
}
