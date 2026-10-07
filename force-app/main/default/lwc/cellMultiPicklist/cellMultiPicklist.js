/**
 * cellMultiPicklist — display and edit for multi-select picklists.
 *
 * Edits with lightning-dual-listbox, the control Salesforce's own record pages
 * and list views use for these fields, so it is already familiar and
 * keyboard-accessible. Done (or Enter on Done) saves; Escape or Cancel leaves
 * the cell as it was; leaving the editor saves, as every other editor does.
 *
 * TC-040: the stored value is semicolon-delimited and is shown as a comma
 * list; an unchanged value is committed back exactly as stored.
 * TC-041: a single value has no trailing separator.
 * TC-036, for multi-select: a stored value no longer active is kept and shown
 * as "(inactive)", never dropped.
 *
 * The editor's box is the cell's width, like every editor's, and says what is chosen so far; the two lists and the buttons
 * need about 26rem, so they hang below the box like a menu, opening
 * leftwards when the table says there is no room to the right
 * (`dropdownAlign`).
 */
import { LightningElement, api } from 'lwc';
import { formatValue, isBlank } from 'c/gridFormat';

export const REQUIRED_MESSAGE = 'Complete this field.';

export default class CellMultiPicklist extends LightningElement {
    @api value;
    @api mode = 'display';
    @api label = '';
    @api options = [];
    @api required = false;
    /** 'left' (the default) or 'right': which edge of the box the lists hang from. */
    @api dropdownAlign = 'left';
    /** true: the lists open above the box, when the table says there is no room below it. */
    @api dropdownUp = false;

    draft;
    error = '';

    @api
    focus() {
        const box = this.template.querySelector('lightning-dual-listbox');
        if (box && typeof box.focus === 'function') box.focus();
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    get text() {
        return formatValue(this.value, { type: 'multipicklist', options: this.options });
    }

    /** What is chosen so far, as the cell will show it. */
    get summary() {
        return formatValue(this.selected.join(';'), { type: 'multipicklist', options: this.options });
    }

    get panelClass() {
        return (
            'slds-dropdown slds-p-around_small rh-multi-panel ' +
            (this.dropdownAlign === 'right' ? 'slds-dropdown_right' : 'slds-dropdown_left') +
            (this.dropdownUp ? ' slds-dropdown_bottom' : '')
        );
    }

    /** The box only reports: a click on it leaves focus in the lists. */
    handleSummaryMouseDown(event) {
        event.preventDefault();
    }

    get storedValues() {
        return isBlank(this.value) ? [] : String(this.value).split(';');
    }

    get selected() {
        return this.draft !== undefined ? this.draft : this.storedValues;
    }

    get listOptions() {
        const active = (this.options || []).map(o => ({ value: o.value, label: o.label }));
        const known = new Set(active.map(o => o.value));
        this.storedValues.filter(v => !known.has(v)).forEach(v => active.push({ value: v, label: v + ' (inactive)' }));
        return active;
    }

    handleChange(event) {
        this.draft = event.detail.value.slice();
        this.error = '';
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.cancel();
        } else if (event.key === 'Tab' && !event.shiftKey && event.target.dataset.done !== undefined) {
            // Tab off the last control commits, as in every other editor.
            event.preventDefault();
            event.stopPropagation();
            this.commit();
        }
    }

    handleDone() {
        this.commit();
    }

    handleCancel() {
        this.cancel();
    }

    cancel() {
        this.draft = undefined;
        this.error = '';
        this.dispatchEvent(new CustomEvent('cancel'));
    }

    /**
     * A required field left blank is refused here, in the editor, with the
     * message a record form gives: the editor stays open. Returns
     * whether the value was committed.
     */
    @api
    commit() {
        let value = this.value === undefined ? null : this.value;
        if (this.draft !== undefined) {
            value = this.draft.length ? this.draft.join(';') : null;
        }
        if (this.required && isBlank(value)) {
            this.error = REQUIRED_MESSAGE;
            return false;
        }
        this.draft = undefined;
        this.error = '';
        this.dispatchEvent(new CustomEvent('commit', { detail: { value } }));
        return true;
    }
}
