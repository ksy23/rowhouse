/**
 * gridEditRecord — Salesforce's own edit form for one record, over the grid:
 * a row's Edit, as a list view's row menu has it.
 *
 * lightning-record-form in edit mode, with the record's full page layout
 * (its record type's), so every field behaves as on the record's own Edit:
 * lookups, picklists by record type, compound names and addresses, required
 * fields, validation and duplicate rules. Salesforce saves the record, not
 * the grid: the grid's log, in a grid that keeps one, does not record it, as
 * it does not record a change made on the record's page.
 *
 * The SLDS modal blueprint, as the grid's other dialogs: focus starts on the
 * close button and stays inside (a guard at each end sends it round); Escape
 * cancels.
 *
 * INPUTS (plain values, HR-28)
 *   recordId       the record to edit
 *   objectApiName  its object
 *   recordName     its name, for the heading
 * EVENTS OUT
 *   saved { id }, cancel
 */
import { LightningElement, api } from 'lwc';

export default class GridEditRecord extends LightningElement {
    @api recordId;
    @api objectApiName;
    @api recordName = '';

    // Non-reactive (HR-20).
    _layout = { focused: false };

    renderedCallback() {
        if (this._layout.focused) return;
        const close = this.template.querySelector('.rh-edit-record-close');
        if (close && typeof close.focus === 'function') {
            this._layout.focused = true;
            close.focus();
        }
    }

    get heading() {
        return this.recordName ? `Edit ${this.recordName}` : 'Edit record';
    }

    handleSuccess(event) {
        const id = (event.detail && event.detail.id) || this.recordId;
        this.dispatchEvent(new CustomEvent('saved', { detail: { id } }));
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

    /** Shift+Tab from the first control: round to the form, the last. */
    handleGuardStart() {
        const form = this.template.querySelector('.rh-edit-record-form');
        if (form && typeof form.focus === 'function') form.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const close = this.template.querySelector('.rh-edit-record-close');
        if (close && typeof close.focus === 'function') close.focus();
    }
}
