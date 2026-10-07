/**
 * gridFilterPanel — filters a grid by one column: a condition, a value
 * (or two, for Between), Apply, Remove filter and Cancel. It opens under the
 * column's header from its menu's "Filter…".
 *
 * INPUTS
 *   column  the grid's column: { field, label, type, options, referenceTo, scale }
 *   filter  the column's filter now, { field, operator, value, valueTo }, or null
 *
 * EVENTS OUT (plain-object details, HR-28)
 *   apply   { filter }   a complete filter for this column (c/gridFilters toRequest)
 *   remove  (no detail)  the column's filter is taken off
 *   cancel  (no detail)  nothing changes
 *
 * Native controls, not lightning-combobox or lightning-input: their lists
 * and calendars hang in the grid's scrolling box, which clips them (found on
 * the Grid Admin tab), while the browser's own date and time
 * pickers do not. Enter applies, Escape cancels; focus starts on the
 * condition.
 */
import { LightningElement, api } from 'lwc';
import { operatorsFor, needsValue, inputKind, choicesFor, toRequest, problemOf, IS_ME } from 'c/gridFilters';

export default class GridFilterPanel extends LightningElement {
    @api column;
    _filter = null;
    /** What the panel holds now: { operator, value, valueTo }. */
    draft = { operator: null, value: '', valueTo: '' };
    problem = '';
    // Non-reactive (HR-20).
    _state = { connected: false };

    @api
    get filter() {
        return this._filter;
    }
    set filter(value) {
        this._filter = value || null;
        // Before it is connected the column may not be set yet: connectedCallback starts the draft.
        if (this._state.connected) this.draft = this.initialDraft();
    }

    /**
     * Where the panel ends, in the viewport: the grid makes that much room
     * below its last row, so a short grid does not cut the panel off.
     */
    @api
    panelBottom() {
        const panel = this.template.querySelector('.rh-filter-panel');
        return panel ? panel.getBoundingClientRect().bottom : 0;
    }

    @api
    focus() {
        const select = this.template.querySelector('select.rh-filter-operator');
        if (select) select.focus();
    }

    connectedCallback() {
        this._state.connected = true;
        this.draft = this.initialDraft();
    }

    disconnectedCallback() {
        this._state.connected = false;
    }

    initialDraft() {
        const f = this._filter;
        const ops = this.column ? operatorsFor(this.column) : [];
        if (f && f.operator) {
            const isMe = f.operator === 'equals' && f.value === '$User';
            return { operator: isMe ? IS_ME : f.operator, value: isMe ? '' : f.value || '', valueTo: f.valueTo || '' };
        }
        const operator = ops.length ? ops[0].value : 'equals';
        const choices = this.column && inputKind(this.column, operator) === 'select' ? choicesFor(this.column) : [];
        return { operator, value: choices.length ? choices[0].value : '', valueTo: '' };
    }

    get heading() {
        return `Filter ${this.column ? this.column.label || this.column.field : ''}`;
    }

    get hasFilter() {
        return Boolean(this._filter);
    }

    get operators() {
        return operatorsFor(this.column || {}).map(o => ({ ...o, selected: o.value === this.draft.operator }));
    }

    get kind() {
        return inputKind(this.column || {}, this.draft.operator);
    }

    get showValue() {
        return needsValue(this.draft.operator);
    }

    get isSelect() {
        return this.kind === 'select';
    }

    get isBetween() {
        return this.draft.operator === 'between';
    }

    get inputType() {
        return { number: 'number', date: 'date', time: 'time' }[this.kind] || 'text';
    }

    get valueLabel() {
        return this.isBetween ? 'From' : 'Value';
    }

    get valueClass() {
        return 'slds-form-element slds-m-bottom_x-small' + (this.problem ? ' slds-has-error' : '');
    }

    get choices() {
        return choicesFor(this.column || {}).map(c => ({ ...c, selected: c.value === this.draft.value }));
    }

    handleOperatorChange(event) {
        const operator = event.target.value;
        let value = this.draft.value;
        // A list's first choice, so a picklist filter is complete as soon as it opens.
        if (inputKind(this.column, operator) === 'select' && !choicesFor(this.column).some(c => c.value === value)) {
            const choices = choicesFor(this.column);
            value = choices.length ? choices[0].value : '';
        }
        this.draft = { ...this.draft, operator, value };
        this.problem = '';
    }

    handleValueChange(event) {
        this.draft = { ...this.draft, value: event.target.value };
        this.problem = '';
    }

    handleValueToChange(event) {
        this.draft = { ...this.draft, valueTo: event.target.value };
        this.problem = '';
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.dispatchEvent(new CustomEvent('cancel'));
        } else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') {
            event.preventDefault();
            event.stopPropagation();
            this.handleApply();
        } else {
            // The grid's keys (arrows, typing to edit) are not for the panel's controls.
            event.stopPropagation();
        }
    }

    handleApply() {
        const filter = { field: this.column.field, ...this.draft };
        const problem = problemOf(filter, this.column);
        const request = problem ? null : toRequest(filter);
        if (!request) {
            this.problem = problem || 'Complete the filter.';
            return;
        }
        this.dispatchEvent(new CustomEvent('apply', { detail: { filter: request } }));
    }

    handleRemove() {
        this.dispatchEvent(new CustomEvent('remove'));
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }
}
