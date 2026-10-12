/**
 * gridChangeOwner — a row's Change Owner, as a list view's row menu has it:
 * choose a user or a queue, and the record has a new owner at once.
 *
 * The search is c/cellLookup's, asking the server for owners
 * (GridController.searchOwners): active users, then queues that accept the
 * object, only where the grid offers Change Owner. The grid saves the change
 * when the user confirms (GridController.changeOwner); while it does, the
 * dialog shows a spinner and its buttons wait. If the server refuses, the
 * dialog stays open and says why.
 *
 * The SLDS modal blueprint, as the grid's other dialogs: focus starts in the
 * search box and stays inside (a guard at each end sends it round); Escape
 * cancels, after closing the list of matches if it is open.
 *
 * INPUTS (plain values, HR-28)
 *   configName   the grid, for the owner search
 *   recordName   the record's name, for the question
 *   busy         the change is being saved
 *   error        why the last attempt was refused, or empty
 * EVENTS OUT
 *   confirm { ownerId, ownerName }, cancel
 */
import { LightningElement, api } from 'lwc';

export default class GridChangeOwner extends LightningElement {
    @api configName;
    @api recordName = '';
    @api busy = false;
    @api error = '';

    /** The owner chosen: { value, label }, or null. */
    chosen = null;

    // Non-reactive (HR-20).
    _layout = { focused: false };

    renderedCallback() {
        if (this._layout.focused) return;
        const lookup = this.template.querySelector('c-cell-lookup');
        if (lookup && typeof lookup.focus === 'function') {
            this._layout.focused = true;
            lookup.focus();
        }
    }

    get question() {
        return this.recordName
            ? `Who should own ${this.recordName}? Choose a user, or a queue.`
            : 'Who should own this record? Choose a user, or a queue.';
    }

    get confirmDisabled() {
        return this.busy || !this.chosen || !this.chosen.value;
    }

    handleChoose(event) {
        const { value, label } = event.detail || {};
        this.chosen = value ? { value, label: label || '' } : null;
    }

    /** Escape in the search box: the first closes its list; with no list open, the dialog. */
    handleLookupCancel(event) {
        if (event.detail && event.detail.listOpen) return;
        this.handleCancel();
    }

    handleConfirm() {
        if (this.confirmDisabled) return;
        this.dispatchEvent(
            new CustomEvent('confirm', { detail: { ownerId: this.chosen.value, ownerName: this.chosen.label } })
        );
    }

    handleCancel() {
        if (this.busy) return;
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
        const last = this.confirmDisabled
            ? this.template.querySelector('.rh-change-owner-cancel')
            : this.template.querySelector('.rh-change-owner-confirm');
        if (last) last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const close = this.template.querySelector('.rh-change-owner-close');
        if (close) close.focus();
    }
}
