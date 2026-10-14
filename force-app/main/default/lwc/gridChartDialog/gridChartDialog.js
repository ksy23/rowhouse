/**
 * gridChartDialog — Edit Chart: what the grid's chart shows, in a list
 * view's words. Chart Type; Aggregate Type (Average, Sum or Count); Aggregate
 * Field, a number column, for Average and Sum (Count counts the records, so
 * it needs none); Grouping Field, a column the grid can group by; and for a
 * date, Group Dates By.
 *
 * The SLDS modal blueprint, as the grid's other dialogs: focus starts on the
 * first field and stays inside (a guard at each end sends it round); Escape
 * cancels.
 *
 * INPUTS (plain values, HR-28)
 *   chart     the chart as it is (gridCharts normalizeChart)
 *   columns   the grid's columns
 * EVENTS OUT
 *   save { chart }, cancel
 */
import { LightningElement, api } from 'lwc';
import { DATE_UNITS, UNIT_LABELS, isDateColumn } from 'c/gridGroups';
import { CHART_TYPES, MEASURES, groupByColumns, measureColumns, normalizeChart } from 'c/gridCharts';

export default class GridChartDialog extends LightningElement {
    @api columns;

    type = 'hbar';
    measure = 'count';
    field = null;
    groupBy = null;
    unit = null;

    // Non-reactive (HR-20).
    _layout = { focused: false };

    @api
    get chart() {
        return { type: this.type, measure: this.measure, field: this.field, groupBy: this.groupBy, unit: this.unit };
    }
    set chart(value) {
        const c = value || {};
        this.type = c.type || 'hbar';
        this.measure = c.measure || 'count';
        this.field = c.field || null;
        this.groupBy = c.groupBy || null;
        this.unit = c.unit || null;
    }

    renderedCallback() {
        if (this._layout.focused) return;
        const first = this.template.querySelector('.rh-chart-type');
        if (first && typeof first.focus === 'function') {
            this._layout.focused = true;
            first.focus();
        }
    }

    get typeOptions() {
        return CHART_TYPES.map(t => ({ value: t.value, label: t.label }));
    }

    get numberColumns() {
        return measureColumns(this.columns);
    }

    /** Average and Sum only where there is a number column to add up. */
    get measureOptions() {
        const canAdd = this.numberColumns.length > 0;
        return MEASURES.filter(m => canAdd || m.value === 'count').map(m => ({ value: m.value, label: m.label }));
    }

    get needsField() {
        return this.measure !== 'count';
    }

    get fieldOptions() {
        return this.numberColumns.map(c => ({ value: c.field, label: c.label || c.field }));
    }

    get groupOptions() {
        return groupByColumns(this.columns).map(c => ({ value: c.field, label: c.label || c.field }));
    }

    get groupColumn() {
        return groupByColumns(this.columns).find(c => c.field === this.groupBy) || null;
    }

    get isDate() {
        return isDateColumn(this.groupColumn);
    }

    get unitOptions() {
        return DATE_UNITS.map(u => ({ value: u, label: UNIT_LABELS[u] }));
    }

    get saveDisabled() {
        return !this.groupBy || (this.needsField && !this.field);
    }

    handleType(event) {
        this.type = event.detail.value;
    }

    handleMeasure(event) {
        this.measure = event.detail.value;
        if (this.measure !== 'count' && !this.field && this.fieldOptions.length === 1) {
            this.field = this.fieldOptions[0].value;
        }
    }

    handleField(event) {
        this.field = event.detail.value;
    }

    handleGroup(event) {
        this.groupBy = event.detail.value;
        this.unit = this.isDate ? this.unit || 'month' : null;
    }

    handleUnit(event) {
        this.unit = event.detail.value;
    }

    handleSave() {
        if (this.saveDisabled) return;
        const chart = normalizeChart(
            {
                type: this.type,
                measure: this.measure,
                field: this.needsField ? this.field : null,
                groupBy: this.groupBy,
                unit: this.unit
            },
            this.columns
        );
        if (chart) this.dispatchEvent(new CustomEvent('save', { detail: { chart } }));
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.handleCancel();
        }
    }

    /** Shift+Tab from the first control: round to the last enabled button. */
    handleGuardStart() {
        const last = this.saveDisabled
            ? this.template.querySelector('.rh-chart-cancel')
            : this.template.querySelector('.rh-chart-save');
        if (last) last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const close = this.template.querySelector('.rh-chart-close');
        if (close) close.focus();
    }
}
