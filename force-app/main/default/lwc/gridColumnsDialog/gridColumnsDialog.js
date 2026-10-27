/**
 * gridColumnsDialog — Choose columns: which of the grid's columns this
 * user sees, and in what order.
 *
 * Two lists, Available and Visible, with buttons to move a column between
 * them and up or down: lightning-dual-listbox, the control a list view's
 * Select Fields to Display uses. It works from the keyboard, so this dialog is
 * the keyboard way to reorder columns (a header can also be dragged, with a
 * mouse). A column the admin keeps on screen (Always Shown) cannot leave the
 * Visible list, and at least one column stays in it.
 *
 * The SLDS modal blueprint, as the other dialogs: focus starts on the lists
 * and stays in the dialog (a guard at each end sends it round); Escape
 * cancels.
 *
 * INPUTS (plain values, HR-28)
 *   columns   the grid's columns, [{ field, label, alwaysShown }], in the admin's order
 *   choice    this user's choice, { order, hidden }, or null for the admin's
 *   viewShown a saved view is shown: the choice changes the view, kept for
 *             everyone who sees it once saved, not only for this user
 * EVENTS OUT
 *   save      { visible: [field] } the columns to show, in order
 *   cancel
 */
import { LightningElement, api } from 'lwc';
import { shownColumns } from 'c/gridColumns';

export default class GridColumnsDialog extends LightningElement {
    @api columns = [];
    @api choice = null;
    @api viewShown = false;

    /** The Visible list as the user has it now; null until they change it. */
    picked = null;

    // Non-reactive (HR-20).
    _layout = { focused: false };

    renderedCallback() {
        if (this._layout.focused) return;
        const lists = this.template.querySelector('lightning-dual-listbox');
        if (lists) {
            this._layout.focused = true;
            lists.focus();
        }
    }

    get allColumns() {
        return Array.isArray(this.columns) ? this.columns : [];
    }

    /** Every column, labelled as its header is. Options list in the admin's order. */
    get options() {
        return this.allColumns.map(c => ({ label: c.label || c.field, value: c.field }));
    }

    get value() {
        return this.picked || shownColumns(this.allColumns, this.choice).map(c => c.field);
    }

    get requiredOptions() {
        return this.allColumns.filter(c => c.alwaysShown === true).map(c => c.field);
    }

    /** One line about the columns that cannot be hidden, when there are any. */
    get keptText() {
        const kept = this.allColumns.filter(c => c.alwaysShown === true).map(c => c.label || c.field);
        if (!kept.length) return '';
        const names = kept.length === 1 ? kept[0] : kept.slice(0, -1).join(', ') + ' and ' + kept[kept.length - 1];
        return `Your admin keeps ${names} on screen: ${kept.length === 1 ? 'it' : 'they'} can be moved, not hidden.`;
    }

    handleChange(event) {
        const value = event.detail && Array.isArray(event.detail.value) ? event.detail.value : [];
        this.picked = value.slice();
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.dispatchEvent(new CustomEvent('cancel'));
        }
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }

    handleSave() {
        this.dispatchEvent(new CustomEvent('save', { detail: { visible: this.value.slice() } }));
    }

    /** Shift+Tab from the first control: round to the last. */
    handleGuardStart() {
        const last = this.template.querySelector('.rh-columns-save');
        if (last) last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const first = this.template.querySelector('.rh-columns-close');
        if (first) first.focus();
    }
}
