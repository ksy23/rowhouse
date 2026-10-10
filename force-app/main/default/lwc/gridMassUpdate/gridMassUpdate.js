/**
 * gridMassUpdate — the dialog that changes one field on the selected rows.
 *
 * The user picks one of the grid's editable columns and a value. Apply hands
 * { field, value, valueLabel } to gridApp, which records it as unsaved edits in
 * one undo step, as it does a paste: nothing is written until Save, and the
 * save path checks every value again on the server (HR-6).
 *
 * The value is entered as the grid's own editors take it:
 *   text, email, phone, url    a text box; empty clears the field
 *   number, currency, percent  a text box, read by the grid's paste rules (the
 *                              user's separators, a currency symbol, a percent
 *                              sign) and rounded to the field's scale
 *   date                       a date picker
 *   date/time                  a date and time picker, in the user's
 *                              Salesforce time zone
 *   time                       a time picker
 *   text area                  a text area, with the field's length
 *   checkbox                   Checked or Unchecked
 *   picklist                   the field's values, and --None-- to clear
 *   multi-select picklist      a dual listbox; nothing chosen clears
 *   lookup, owner              c-cell-lookup, searching as in the grid
 * A required field cannot be cleared.
 *
 * massChanges(), exported, turns the choice into one change per row. A
 * dependent picklist value is refused on rows whose controlling value does not
 * offer it, and a new controlling value clears the dependent values it no
 * longer allows, both as the grid does for a paste.
 *
 * The dialog is the SLDS modal blueprint. Focus starts on the field choice and
 * stays in the dialog (a guard at each end sends it round), Escape cancels, and
 * Enter in a text, number or date box applies.
 *
 * AFTER THE UX REVIEW
 * - It names the rows it changes ("Acme, Globex and 8 more"), so the user can
 *   see they selected the right ones without closing it.
 * - Once a field is chosen, it says what the rows hold now ("Currently: Open
 *   (5), Won (3), blank (2)"): whether the change is needed, and what it
 *   replaces.
 * - It is tall only for a lookup's matches and a dual listbox; for a text box
 *   or a picklist a tall empty dialog looked unfinished.
 */
import { LightningElement, api } from 'lwc';
import TIME_ZONE from '@salesforce/i18n/timeZone';
import { parseCell } from 'c/gridClipboard';
import { isValidDependent, dependentClears, isLookup, lookupText } from 'c/gridFields';
import { isBlank, formatValue } from 'c/gridFormat';

const TEXT_INPUT = { text: 'text', string: 'text', email: 'email', phone: 'tel', url: 'url' };
const NUMBER_TYPES = new Set(['number', 'double', 'integer', 'long', 'currency', 'percent']);
const KIND_BY_TYPE = {
    date: 'date',
    datetime: 'datetime',
    time: 'time',
    textarea: 'textarea',
    checkbox: 'checkbox',
    boolean: 'checkbox',
    picklist: 'picklist',
    multipicklist: 'multi',
    reference: 'lookup',
    owner: 'lookup'
};
/** The picklist's "--None--" choice. */
const NONE = '';
export const REQUIRED_MESSAGE = 'Complete this field.';
/** Rows named in the dialog before "and N more". */
export const NAMED_ROWS = 3;
/** Values listed in "Currently: …" before "and N other values". */
export const SHOWN_VALUES = 3;

const has = (obj, key) => Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);

/**
 * The changes one mass update makes: { changes, errors, cleared }.
 *
 *   ids      the selected record Ids
 *   column   the column being changed
 *   value    its new value, as a cell holds it
 *   rowById  Map of the loaded rows by Id; an Id not loaded is skipped
 *   drafts   unsaved edits, which are the current values where they exist
 *   columns  every column, for dependent picklists and their labels
 *
 * `changes` includes the dependent values cleared (also in `cleared`); `errors`
 * are cells that keep their value, with the reason.
 */
export function massChanges({ ids, column, value, rowById, drafts, columns }) {
    const original = (id, field) => {
        const row = rowById.get(id);
        return row ? row[field] : null;
    };
    const current = (id, field) => (has(drafts && drafts[id], field) ? drafts[id][field] : original(id, field));
    const all = columns || [];
    const controller = column.dependentOn
        ? (all.find(c => c.field === column.dependentOn) || {}).label || column.dependentOn
        : null;
    const changes = [];
    const errors = [];
    (ids || []).forEach(id => {
        if (!rowById.has(id)) return;
        if (column.dependentOn) {
            const controlling = current(id, column.dependentOn);
            if (!isValidDependent(column, value, controlling)) {
                errors.push({
                    recordId: id,
                    field: column.field,
                    message: `${value} is not offered when ${controller} is ${isBlank(controlling) ? 'blank' : controlling}.`
                });
                return;
            }
        }
        changes.push({ recordId: id, field: column.field, value, originalValue: original(id, column.field) });
    });
    const cleared = dependentClears(changes, all, current, original);
    return { changes: changes.concat(cleared), errors, cleared };
}

export default class GridMassUpdate extends LightningElement {
    /** Every column of the grid; the editable ones are offered. */
    @api columns = [];
    /** How many rows are selected. */
    @api count = 0;
    /** The grid configuration, which a lookup searches through. */
    @api configName;
    /** The selected rows as they are now, unsaved edits included: plain objects. */
    @api rows = [];
    /** Lookup names by record Id, for the current values. */
    @api refNames = {};

    field = NONE;
    text = '';
    choice;
    chosen = [];
    lookup = { value: null, label: null };
    error = '';

    // Non-reactive (HR-20).
    _layout = { focused: false };

    connectedCallback() {
        const editable = this.editable;
        if (editable.length === 1) this.field = editable[0].field;
    }

    /** Focus starts on the field choice, once. */
    renderedCallback() {
        if (this._layout.focused) return;
        const first = this.template.querySelector('[data-first]');
        if (first && typeof first.focus === 'function') {
            this._layout.focused = true;
            first.focus();
        }
    }

    // ============================================================ what is shown

    get editable() {
        return (this.columns || []).filter(c => c.editable);
    }

    get fieldOptions() {
        return this.editable.map(c => ({ label: c.label, value: c.field }));
    }

    get column() {
        return this.editable.find(c => c.field === this.field) || null;
    }

    get kind() {
        const c = this.column;
        if (!c) return null;
        const type = c.type || 'text';
        if (NUMBER_TYPES.has(type)) return 'number';
        return KIND_BY_TYPE[type] || 'text';
    }

    get heading() {
        const n = this.count || 0;
        return `Change ${n} selected ${n === 1 ? 'row' : 'rows'}`;
    }

    get valueLabel() {
        return this.column ? `New ${this.column.label}` : 'New value';
    }

    /** The column that names a row: the name field, else the first. */
    get nameColumn() {
        const cols = this.columns || [];
        return cols.find(c => c.isName) || cols[0] || null;
    }

    /** "Acme, Globex, Initech and 7 more": the rows the change goes to. */
    get rowNames() {
        const rows = Array.isArray(this.rows) ? this.rows : [];
        const col = this.nameColumn;
        if (!rows.length || !col) return '';
        const names = rows.slice(0, NAMED_ROWS).map(r => this.shown(r[col.field], col, r) || 'a row with no name');
        const more = Math.max(0, (this.count || rows.length) - names.length);
        if (!more)
            return names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
        return `${names.join(', ')} and ${more} more`;
    }

    /** "Currently: Open (5), Won (3), blank (2)": what the chosen field holds on these rows. */
    get currentValues() {
        const c = this.column;
        const rows = Array.isArray(this.rows) ? this.rows : [];
        if (!c || !rows.length) return '';
        const counts = new Map();
        rows.forEach(r => {
            const text = this.shown(r[c.field], c, r) || 'blank';
            counts.set(text, (counts.get(text) || 0) + 1);
        });
        if (counts.size === 1) {
            const [only] = counts.keys();
            return rows.length === 1 ? `Currently: ${only}` : `Currently: ${only} on every row`;
        }
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const shown = sorted.slice(0, SHOWN_VALUES).map(([text, n]) => `${text} (${n})`);
        const others = sorted.length - shown.length;
        return (
            'Currently: ' +
            shown.join(', ') +
            (others ? `, and ${others} other ${others === 1 ? 'value' : 'values'}` : '')
        );
    }

    /** A value as the grid shows it on its row: a lookup by name, anything else formatted. */
    shown(value, column, row = null) {
        if (isBlank(value)) return '';
        return isLookup(column.type) ? lookupText(value, this.refNames || {}) : formatValue(value, column, row);
    }

    /** Tall only where a list opens inside the dialog. */
    get bodyClass() {
        return (
            'slds-modal__content slds-p-around_medium rh-mass-body' +
            (this.isLookup || this.isMulti ? ' rh-mass-body_tall' : '')
        );
    }

    /** The lookup's targets' icons, for its matches. */
    get lookupIcons() {
        return (this.column && this.column.referenceIcons) || null;
    }

    get isTextBox() {
        return this.kind === 'text' || this.kind === 'number';
    }

    get inputType() {
        return this.kind === 'number' ? 'text' : TEXT_INPUT[this.column.type] || 'text';
    }

    get isDate() {
        return this.kind === 'date';
    }

    get isDateTime() {
        return this.kind === 'datetime';
    }

    get isTime() {
        return this.kind === 'time';
    }

    get isTextarea() {
        return this.kind === 'textarea';
    }

    /** The user's Salesforce time zone, which a date/time is entered in. */
    get timeZone() {
        return TIME_ZONE;
    }

    get maxLength() {
        return (this.column && this.column.length) || null;
    }

    get isCheckbox() {
        return this.kind === 'checkbox';
    }

    get isPicklist() {
        return this.kind === 'picklist';
    }

    get isMulti() {
        return this.kind === 'multi';
    }

    get isLookup() {
        return this.kind === 'lookup';
    }

    /** One item, keyed by field, so choosing another lookup column starts a fresh search box. */
    get lookupKeys() {
        return this.isLookup ? [{ key: this.field }] : [];
    }

    /** In this form, Tab leaves the search box as it leaves any field. */
    get tabLeaves() {
        return true;
    }

    get checkboxOptions() {
        return [
            { label: 'Checked', value: 'true' },
            { label: 'Unchecked', value: 'false' }
        ];
    }

    get picklistOptions() {
        const options = (this.column.options || []).map(o => ({ label: o.label, value: o.value }));
        return this.column.required ? options : [{ label: '--None--', value: NONE }].concat(options);
    }

    get multiOptions() {
        return (this.column.options || []).map(o => ({ label: o.label, value: o.value }));
    }

    get hint() {
        const c = this.column;
        if (!c) return '';
        if (c.dependentOn) {
            const controller = (this.columns || []).find(x => x.field === c.dependentOn);
            return `Rows where ${(controller && controller.label) || c.dependentOn} does not offer the value keep theirs, and are marked.`;
        }
        if (c.required) return `${c.label} is required, so it cannot be cleared.`;
        if (this.kind === 'checkbox' || this.kind === 'picklist') return '';
        return `Leave it empty to clear ${c.label}.`;
    }

    get applyDisabled() {
        if (!this.column) return true;
        if (this.kind === 'checkbox' || this.kind === 'picklist') return this.choice === undefined;
        return false;
    }

    // ============================================================ input

    handleFieldChange(event) {
        this.field = event.detail.value;
        this.text = '';
        this.choice = undefined;
        this.chosen = [];
        this.lookup = { value: null, label: null };
        this.error = '';
    }

    handleTextChange(event) {
        this.text = event.detail.value == null ? '' : String(event.detail.value);
        this.error = '';
    }

    handleChoiceChange(event) {
        this.choice = event.detail.value;
        this.error = '';
    }

    handleMultiChange(event) {
        this.chosen = (event.detail.value || []).slice();
        this.error = '';
    }

    handleLookupCommit(event) {
        const { value, label } = event.detail || {};
        this.lookup = { value: value || null, label: label || null };
        this.error = '';
    }

    /** Escape in the search box closes its list first, then the dialog. */
    handleLookupCancel(event) {
        if (!(event.detail && event.detail.listOpen)) this.cancel();
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.cancel();
        } else if (
            event.key === 'Enter' &&
            event.target &&
            event.target.dataset &&
            'enterApplies' in event.target.dataset
        ) {
            event.preventDefault();
            this.handleApply();
        }
    }

    /** Shift+Tab from the first control lands here: go round to the last. */
    handleGuardStart() {
        const buttons = this.template.querySelectorAll('.slds-modal__footer button:not([disabled])');
        const last = buttons[buttons.length - 1];
        if (last) last.focus();
    }

    /** Tab from the last control lands here: go round to the first. */
    handleGuardEnd() {
        const first = this.template.querySelector('[data-first]');
        if (first && typeof first.focus === 'function') first.focus();
    }

    // ============================================================ apply

    /** { value, valueLabel } for the current input, or { error }. */
    readValue() {
        const c = this.column;
        let out;
        switch (this.kind) {
            case 'number':
            case 'text':
                out = parseCell(this.text, c);
                break;
            case 'date':
            case 'datetime':
                // lightning-input gives an ISO date, or an ISO instant in UTC.
                out = { value: this.text || null };
                break;
            case 'time':
                // "13:30:00.000" from lightning-input; read as a pasted time is.
                out = this.text ? parseCell(this.text, c) : { value: null };
                break;
            case 'textarea':
                out = { value: this.text === '' ? null : this.text };
                break;
            case 'checkbox':
                out = { value: this.choice === 'true' };
                break;
            case 'picklist':
                out = { value: this.choice === NONE ? null : this.choice };
                break;
            case 'multi':
                out = { value: this.chosen.length ? this.chosen.join(';') : null };
                break;
            case 'lookup':
                out = { value: this.lookup.value, valueLabel: this.lookup.label };
                break;
            default:
                out = { error: 'Choose a field.' };
        }
        if (!out.error && c && c.required && isBlank(out.value)) out = { error: REQUIRED_MESSAGE };
        return out;
    }

    handleApply() {
        if (this.applyDisabled) return;
        const result = this.readValue();
        if (result.error) {
            this.error = result.error;
            return;
        }
        this.dispatchEvent(
            new CustomEvent('apply', {
                detail: { field: this.field, value: result.value, valueLabel: result.valueLabel || null }
            })
        );
    }

    handleCancel() {
        this.cancel();
    }

    cancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }
}
