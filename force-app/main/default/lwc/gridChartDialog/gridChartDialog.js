/**
 * gridChartDialog — Edit chart: what the grid's chart shows. Chart type, as
 * three tiles (Vertical bar, Horizontal bar, Donut); Measure (Record count,
 * Sum of, Average of) beside Field, the number column a sum or an average
 * adds up (Record count needs none, so Field waits, disabled); and Group by,
 * any column the grid can group by, a date by month, quarter or year.
 *
 * The SLDS modal blueprint, as the grid's other dialogs: focus starts on the
 * chosen chart type and stays inside (a guard at each end sends it round);
 * the arrow keys move between the types, as radio buttons do; Escape cancels.
 *
 * INPUTS (plain values, HR-28)
 *   chart     the chart as it is (gridCharts normalizeChart)
 *   columns   the grid's columns
 * EVENTS OUT
 *   save { chart }, cancel
 */
import { LightningElement, api } from 'lwc';
import { UNIT_LABELS, isDateColumn } from 'c/gridGroups';
import { groupByColumns, measureColumns, normalizeChart } from 'c/gridCharts';

/** The tiles, left to right. */
const TYPE_TILES = [
    { value: 'vbar', label: 'Vertical bar' },
    { value: 'hbar', label: 'Horizontal bar' },
    { value: 'donut', label: 'Donut' }
];
/** What a chart measures, in the order its help text gives them. */
const MEASURE_OPTIONS = [
    { value: 'count', label: 'Record count' },
    { value: 'sum', label: 'Sum of' },
    { value: 'average', label: 'Average of' }
];
/** The periods Group by offers a date by. */
const GROUP_UNITS = ['month', 'quarter', 'year'];
/** A Group by choice: a column, or a date column and its period. */
const SEPARATOR = ':';

export default class GridChartDialog extends LightningElement {
    @api columns;

    type = 'hbar';
    measure = 'count';
    field = null;
    groupBy = null;
    unit = null;
    focusedType = null;

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
        const chosen = this.template.querySelector('.rh-chart-type-input:checked');
        if (chosen) {
            this._layout.focused = true;
            chosen.focus();
        }
    }

    get typeTiles() {
        return TYPE_TILES.map(t => {
            const checked = t.value === this.type;
            let tileClass = 'rh-chart-type-tile';
            if (checked) tileClass += ' rh-chart-type-tile_on';
            if (t.value === this.focusedType) tileClass += ' rh-chart-type-tile_focus';
            return {
                ...t,
                checked,
                tileClass,
                isVbar: t.value === 'vbar',
                isHbar: t.value === 'hbar'
            };
        });
    }

    get numberColumns() {
        return measureColumns(this.columns);
    }

    /** Sum of and Average of only where there is a number column to add up. */
    get measureOptions() {
        const canAdd = this.numberColumns.length > 0;
        return MEASURE_OPTIONS.filter(m => canAdd || m.value === 'count').map(m => ({ ...m }));
    }

    get needsField() {
        return this.measure !== 'count';
    }

    get fieldDisabled() {
        return !this.needsField;
    }

    get fieldValue() {
        return this.needsField ? this.field : null;
    }

    get fieldPlaceholder() {
        return this.needsField ? 'Choose a number column' : 'Not used for Record count';
    }

    get fieldOptions() {
        return this.numberColumns.map(c => ({ value: c.field, label: c.label || c.field }));
    }

    /**
     * Each column the grid can group by; a date once for each period, as
     * "Close Date (Month)". A chart kept with another period (a week, a
     * fiscal quarter) keeps its own choice in the list, so it still shows.
     */
    get groupOptions() {
        const options = [];
        groupByColumns(this.columns).forEach(c => {
            const label = c.label || c.field;
            if (!isDateColumn(c)) {
                options.push({ value: c.field, label });
                return;
            }
            const units = [...GROUP_UNITS];
            if (c.field === this.groupBy && this.unit && !units.includes(this.unit)) units.push(this.unit);
            units.forEach(u =>
                options.push({ value: c.field + SEPARATOR + u, label: `${label} (${UNIT_LABELS[u] || u})` })
            );
        });
        return options;
    }

    get groupColumn() {
        return groupByColumns(this.columns).find(c => c.field === this.groupBy) || null;
    }

    get groupValue() {
        if (!this.groupBy) return null;
        return isDateColumn(this.groupColumn) ? this.groupBy + SEPARATOR + (this.unit || 'month') : this.groupBy;
    }

    get saveDisabled() {
        return !this.groupBy || (this.needsField && !this.field);
    }

    handleType(event) {
        this.type = event.target.value;
    }

    handleTypeFocus(event) {
        this.focusedType = event.target.value;
    }

    handleTypeBlur() {
        this.focusedType = null;
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
        const value = event.detail.value || '';
        const at = value.indexOf(SEPARATOR);
        this.groupBy = at < 0 ? value : value.slice(0, at);
        this.unit = at < 0 ? null : value.slice(at + 1);
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
