/**
 * gridDeleteDialog — asks before the selected rows are deleted.
 *
 * It replaces LightningConfirm, which could only say "Delete 8
 * records?": the user could not see which. This names the first few, says
 * where they go (the Recycle Bin, where they can be restored) and what else is
 * lost (unsaved changes on them), and its Delete button is the destructive
 * red, as Salesforce's own delete dialog's is.
 *
 * The SLDS modal blueprint, as the mass update dialog: focus starts on
 * Cancel, the safe choice, and stays in the dialog (a guard at each end sends
 * it round); Escape cancels.
 *
 * INPUTS (plain values, HR-28)
 *   names       the selected rows' names, in order; the first NAMED are shown
 *   count       how many rows are deleted
 *   hasDrafts   some of them have unsaved changes
 *   matching    every record the grid's search and filters match is deleted,
 *               not only the loaded rows: the dialog says so
 * EVENTS OUT
 *   confirm, cancel
 */
import { LightningElement, api } from 'lwc';
import LOCALE from '@salesforce/i18n/locale';

/** Rows named before "and N more". */
export const NAMED = 5;

export default class GridDeleteDialog extends LightningElement {
    @api names = [];
    @api count = 0;
    @api hasDrafts = false;
    @api matching = false;

    // Non-reactive (HR-20).
    _layout = { focused: false };

    renderedCallback() {
        if (this._layout.focused) return;
        const cancel = this.template.querySelector('.rh-delete-cancel');
        if (cancel) {
            this._layout.focused = true;
            cancel.focus();
        }
    }

    get noun() {
        const n = Number(this.count) || 0;
        return `${new Intl.NumberFormat(LOCALE).format(n)} ${n === 1 ? 'record' : 'records'}`;
    }

    get heading() {
        return `Delete ${this.noun}?`;
    }

    /** The first NAMED names, then how many more. */
    get namedList() {
        const names = (Array.isArray(this.names) ? this.names : []).map(n => (n ? String(n) : 'A record with no name'));
        const shown = names.slice(0, NAMED);
        const more = Math.max(0, (Number(this.count) || names.length) - shown.length);
        return { shown: shown.map((name, i) => ({ key: i, name })), more };
    }

    get shownNames() {
        return this.namedList.shown;
    }

    get moreText() {
        const more = this.namedList.more;
        return more ? `and ${new Intl.NumberFormat(LOCALE).format(more)} more` : '';
    }

    get whereText() {
        const one = (Number(this.count) || 0) === 1;
        return `${one ? 'It goes' : 'They go'} to the Recycle Bin, where ${one ? 'it' : 'they'} can be restored.`;
    }

    /** With every match selected: the count is more than the rows the user has seen. */
    get matchingText() {
        return this.matching
            ? 'This deletes every record that matches the search and filters, including the ones not loaded in the grid.'
            : '';
    }

    get draftsText() {
        return this.hasDrafts ? 'Unsaved changes on these rows will be lost.' : '';
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

    handleConfirm() {
        this.dispatchEvent(new CustomEvent('confirm'));
    }

    /** Shift+Tab from Cancel, the first control: round to the last. */
    handleGuardStart() {
        const last = this.template.querySelector('.rh-delete-confirm');
        if (last) last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const first = this.template.querySelector('.rh-delete-close');
        if (first) first.focus();
    }
}
