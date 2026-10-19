/**
 * gridChartDialog — Edit chart: what the grid's chart shows. Chart type, as
 * five tiles (Vertical bar, Horizontal bar, Stacked vertical bar, Stacked
 * horizontal bar, Donut); Measure (Record count, Sum of, Average of) beside
 * Field, the number column a sum or an average adds up (Record count needs
 * none, so Field waits, disabled); Group by, any column the grid can group
 * by, a date by month, quarter or year; and beside it Stack by, for stacked
 * bars, a second such column (other types need none, so it waits,
 * disabled). Stacked bars add up, so they count or sum: Average of is not
 * offered for them.
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
import { CHART_TYPES, groupByColumns, measureColumns, normalizeChart, isStacked } from 'c/gridCharts';

/** The tiles, left to right, named as the gear's Display as names them. */
const TYPE_TILES = CHART_TYPES.map(t => ({ value: t.value, label: t.name }));
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
    stackBy = null;
    stackUnit = null;
    focusedType = null;

    // Non-reactive (HR-20).
    _layout = { focused: false };

    @api
    get chart() {
        return {
            type: this.type,
            measure: this.measure,
            field: this.field,
            groupBy: this.groupBy,
            unit: this.unit,
            stackBy: this.stackBy,
            stackUnit: this.stackUnit
        };
    }
    set chart(value) {
        const c = value || {};
        this.type = c.type || 'hbar';
        this.measure = c.measure || 'count';
        this.field = c.field || null;
        this.groupBy = c.groupBy || null;
        this.unit = c.unit || null;
        this.stackBy = c.stackBy || null;
        this.stackUnit = c.stackUnit || null;
        // Stacked bars add up: an average becomes a sum of the same field.
        if (isStacked(this.type) && this.measure === 'average') this.measure = 'sum';
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
                isHbar: t.value === 'hbar',
                isSvbar: t.value === 'svbar',
                isShbar: t.value === 'shbar'
            };
        });
    }

    get numberColumns() {
        return measureColumns(this.columns);
    }

    get stacked() {
        return isStacked(this.type);
    }

    /** Sum of and Average of only where there is a number column to add up; stacked bars do not average. */
    get measureOptions() {
        const canAdd = this.numberColumns.length > 0;
        return MEASURE_OPTIONS.filter(m => canAdd || m.value === 'count')
            .filter(m => !this.stacked || m.value !== 'average')
            .map(m => ({ ...m }));
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
     * Each column the grid can group by, but `except`; a date once for each
     * period, as "Close Date (Month)". A chart kept with another period (a
     * week, a fiscal quarter) keeps its own choice in the list, so it still
     * shows.
     */
    columnOptions(except, chosen, chosenUnit) {
        const options = [];
        groupByColumns(this.columns)
            .filter(c => c.field !== except)
            .forEach(c => {
                const label = c.label || c.field;
                if (!isDateColumn(c)) {
                    options.push({ value: c.field, label });
                    return;
                }
                const units = [...GROUP_UNITS];
                if (c.field === chosen && chosenUnit && !units.includes(chosenUnit)) units.push(chosenUnit);
                units.forEach(u =>
                    options.push({ value: c.field + SEPARATOR + u, label: `${label} (${UNIT_LABELS[u] || u})` })
                );
            });
        return options;
    }

    get groupOptions() {
        return this.columnOptions(this.stacked ? this.stackBy : null, this.groupBy, this.unit);
    }

    get groupColumn() {
        return groupByColumns(this.columns).find(c => c.field === this.groupBy) || null;
    }

    get groupValue() {
        if (!this.groupBy) return null;
        return isDateColumn(this.groupColumn) ? this.groupBy + SEPARATOR + (this.unit || 'month') : this.groupBy;
    }

    get stackOptions() {
        return this.columnOptions(this.groupBy, this.stackBy, this.stackUnit);
    }

    get stackDisabled() {
        return !this.stacked;
    }

    get stackPlaceholder() {
        return this.stacked ? 'Choose a column' : 'Only for stacked bars';
    }

    get stackValue() {
        if (!this.stacked || !this.stackBy || this.stackBy === this.groupBy) return null;
        const c = groupByColumns(this.columns).find(col => col.field === this.stackBy);
        if (!c) return null;
        return isDateColumn(c) ? this.stackBy + SEPARATOR + (this.stackUnit || 'month') : this.stackBy;
    }

    get saveDisabled() {
        return !this.groupBy || (this.needsField && !this.field) || (this.stacked && !this.stackValue);
    }

    handleType(event) {
        this.type = event.target.value;
        // Stacked bars add up: an average becomes a sum of the same field.
        if (this.stacked && this.measure === 'average') this.measure = 'sum';
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

    handleStack(event) {
        const value = event.detail.value || '';
        const at = value.indexOf(SEPARATOR);
        this.stackBy = at < 0 ? value : value.slice(0, at);
        this.stackUnit = at < 0 ? null : value.slice(at + 1);
    }

    handleSave() {
        if (this.saveDisabled) return;
        const chart = normalizeChart(
            {
                type: this.type,
                measure: this.measure,
                field: this.needsField ? this.field : null,
                groupBy: this.groupBy,
                unit: this.unit,
                stackBy: this.stackBy,
                stackUnit: this.stackUnit
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
