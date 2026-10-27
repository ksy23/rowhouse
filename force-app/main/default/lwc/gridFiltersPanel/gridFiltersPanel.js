/**
 * gridFiltersPanel — the Filters panel beside the grid, as a list view's:
 * the admin's filters, locked; the user's, numbered, each a card that opens
 * its editor (c/gridFilterPanel, inline) and has a remove button; Add
 * Filter, which asks for a column first; Remove All; and Add Filter Logic,
 * which joins the numbered filters with AND, OR and NOT ("1 AND (2 OR 3)").
 * A column may have more than one filter here (Stage equals Prospecting,
 * Stage equals Qualification, joined by OR).
 *
 * Changes wait in the panel until Apply, as a list view's wait until its
 * Save: then the grid asks the server again. Cancel puts the panel back as it
 * was. Apply checks the filter logic first, in the server's words
 * (c/gridFilters parseLogic); the server checks everything again.
 *
 * INPUTS (plain values, HR-28)
 *   columns       the grid's columns
 *   filters       the user's filters now, [{ field, operator, value, valueTo }]
 *   logic         their filter logic now, '' for none
 *   adminFilters  [{ text }] the admin's, shown locked
 * EVENTS OUT
 *   apply  { filters, logic }
 *   close
 */
import { LightningElement, api } from 'lwc';
import { canFilter, describeFilter, parseLogic, MAX_FILTERS, withFilterAt, withoutFilterAt } from 'c/gridFilters';

export default class GridFiltersPanel extends LightningElement {
    @api columns = [];
    @api adminFilters = [];

    _filters = [];
    _logic = '';
    /** What the panel holds: the filters and logic, as changed here. */
    draftFilters = [];
    draftLogic = '';
    logicOpen = false;
    logicProblem = '';
    /** The card being edited (its place), 'new' while a filter is added, or null. */
    editing = null;
    /** The column a new filter is for, once chosen. */
    newField = '';

    // Non-reactive (HR-20).
    _layout = { focus: null };

    @api
    get filters() {
        return this._filters;
    }
    set filters(value) {
        this._filters = Array.isArray(value) ? value : [];
        this.reset();
    }

    @api
    get logic() {
        return this._logic;
    }
    set logic(value) {
        this._logic = typeof value === 'string' ? value : '';
        this.reset();
    }

    /** Focus the panel: its first control. */
    @api
    focus() {
        const first = this.template.querySelector('.rh-filters-close');
        if (first) first.focus();
    }

    reset() {
        this.draftFilters = this._filters.map(f => ({ ...f }));
        this.draftLogic = this._logic;
        this.logicOpen = Boolean(this._logic);
        this.logicProblem = '';
        this.editing = null;
        this.newField = '';
    }

    renderedCallback() {
        const target = this._layout.focus;
        if (!target) return;
        this._layout.focus = null;
        const el = this.template.querySelector(target);
        if (el && typeof el.focus === 'function') el.focus();
    }

    get byField() {
        return new Map((Array.isArray(this.columns) ? this.columns : []).map(c => [c.field, c]));
    }

    get dirty() {
        return (
            JSON.stringify(this.draftFilters) !== JSON.stringify(this._filters) ||
            (this.draftLogic || '').trim() !== (this._logic || '')
        );
    }

    get applyDisabled() {
        return !this.dirty;
    }

    get lockedCards() {
        return (Array.isArray(this.adminFilters) ? this.adminFilters : []).map((f, i) => ({
            key: 'admin:' + i,
            text: f.text
        }));
    }

    get hasLocked() {
        return this.lockedCards.length > 0;
    }

    get cards() {
        const byField = this.byField;
        return this.draftFilters.map((f, i) => {
            const column = byField.get(f.field) || { field: f.field, label: f.field };
            const text = describeFilter(f, column);
            const label = column.label || f.field;
            const changed = JSON.stringify(f) !== JSON.stringify(this._filters[i] || null);
            return {
                key: 'f:' + i,
                index: i,
                number: i + 1,
                label,
                condition: text.startsWith(label) ? text.slice(label.length).trim() : text,
                cls:
                    'slds-box slds-box_x-small slds-m-bottom_x-small rh-filters-card' +
                    (changed ? ' rh-filters-card_changed' : ''),
                editLabel: `Edit filter ${i + 1}: ${text}`,
                removeLabel: `Remove filter ${i + 1}: ${text}`,
                editing: this.editing === i,
                column,
                filter: f
            };
        });
    }

    get hasFilters() {
        return this.draftFilters.length > 0;
    }

    get matchingText() {
        return this.draftLogic.trim() ? 'Matching the filter logic below' : 'Matching all of these filters';
    }

    get canAdd() {
        return this.draftFilters.length < MAX_FILTERS && this.editing === null;
    }

    get addDisabled() {
        return !this.canAdd;
    }

    get addingNew() {
        return this.editing === 'new';
    }

    /** The columns a new filter can be for, A to Z as their headers read. */
    get fieldOptions() {
        return (Array.isArray(this.columns) ? this.columns : [])
            .filter(canFilter)
            .map(c => ({ value: c.field, label: c.label || c.field, selected: c.field === this.newField }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    get newColumn() {
        return this.newField ? this.byField.get(this.newField) || null : null;
    }

    get showLogicLink() {
        return !this.logicOpen && this.draftFilters.length > 1;
    }

    get atMostText() {
        return this.draftFilters.length >= MAX_FILTERS ? `You can add at most ${MAX_FILTERS} filters.` : '';
    }

    handleKeyDown(event) {
        // The grid's keys are not for the panel's controls.
        event.stopPropagation();
        if (event.key === 'Escape' && this.editing === null) {
            event.preventDefault();
            this.handleClose();
        }
    }

    handleEdit(event) {
        this.editing = Number(event.currentTarget.dataset.index);
    }

    handleEditApply(event) {
        const i = this.editing;
        const filter = event.detail && event.detail.filter;
        if (i === 'new') {
            if (filter) this.draftFilters = [...this.draftFilters, filter];
            this.newField = '';
            this.editing = null;
            this._layout.focus = '.rh-filters-add';
            return;
        }
        if (filter && Number.isInteger(i)) this.draftFilters = withFilterAt(this.draftFilters, i, filter);
        this.editing = null;
        this._layout.focus = `[data-edit="${i}"]`;
    }

    handleEditRemove() {
        const i = this.editing;
        this.editing = null;
        if (Number.isInteger(i)) this.removeAt(i);
    }

    handleEditCancel() {
        const i = this.editing;
        this.editing = null;
        this.newField = '';
        this._layout.focus = i === 'new' || !Number.isInteger(i) ? '.rh-filters-add' : `[data-edit="${i}"]`;
    }

    handleRemove(event) {
        this.removeAt(Number(event.currentTarget.dataset.index));
    }

    /** A filter goes, and the logic's numbers no longer match: the logic is cleared, to be written again. */
    removeAt(i) {
        this.draftFilters = withoutFilterAt(this.draftFilters, i);
        if (this.draftLogic.trim()) {
            this.draftLogic = '';
            this.logicProblem = '';
            this.logicOpen = this.draftFilters.length > 1;
        }
        this._layout.focus = '.rh-filters-add';
    }

    handleAdd() {
        if (!this.canAdd) return;
        this.editing = 'new';
        this.newField = '';
        this._layout.focus = '.rh-filters-field';
    }

    handleFieldChange(event) {
        this.newField = event.target.value;
    }

    handleRemoveAll() {
        this.draftFilters = [];
        this.draftLogic = '';
        this.logicOpen = false;
        this.logicProblem = '';
        this.editing = null;
    }

    handleAddLogic() {
        this.logicOpen = true;
        if (!this.draftLogic.trim()) this.draftLogic = this.draftFilters.map((_, i) => i + 1).join(' AND ');
        this._layout.focus = '.rh-filters-logic';
    }

    handleLogicChange(event) {
        const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.target.value;
        this.draftLogic = String(value || '');
        this.logicProblem = '';
    }

    handleRemoveLogic() {
        this.draftLogic = '';
        this.logicOpen = false;
        this.logicProblem = '';
        this._layout.focus = '.rh-filters-add';
    }

    handleCancel() {
        this.reset();
        this._layout.focus = '.rh-filters-close';
    }

    handleApply() {
        const read = parseLogic(this.draftLogic, this.draftFilters.length);
        if (read.error) {
            this.logicProblem = read.error;
            this._layout.focus = '.rh-filters-logic';
            return;
        }
        this.dispatchEvent(
            new CustomEvent('apply', {
                detail: { filters: this.draftFilters.map(f => ({ ...f })), logic: read.logic }
            })
        );
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }
}
