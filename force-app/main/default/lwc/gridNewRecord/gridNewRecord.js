/**
 * gridNewRecord — creates the record a lookup cell will point to.
 *
 * A lookup's list ends with "New Account" (c/cellLookup) for each target object
 * the user may create. Choosing it opens this dialog over the grid: Salesforce's
 * own record form (lightning-record-form, the object's page layout, its
 * required fields, validation rules and duplicate rules), so the record is
 * made exactly as it would be on the object's own New page. When it is saved
 * the dialog says `created` { id }; the grid puts the new record in the cell
 * as an unsaved change, which Save keeps and Undo takes back. The new record
 * itself stays, as one made from a Salesforce lookup does.
 *
 * The SLDS modal blueprint, as the grid's other dialogs: focus stays inside (a
 * guard at each end sends it round) and Escape cancels.
 *
 * INPUTS (plain values, HR-28)
 *   objectApiName  the object to create a record of
 *   objectLabel    its label, for the heading
 *   fieldLabel     the grid column the record is for
 * EVENTS OUT
 *   created { id }, cancel
 */
import { LightningElement, api } from 'lwc';

export default class GridNewRecord extends LightningElement {
    @api objectApiName;
    @api objectLabel = '';
    @api fieldLabel = '';

    // Non-reactive (HR-20).
    _layout = { focused: false };

    renderedCallback() {
        if (this._layout.focused) return;
        const close = this.template.querySelector('.rh-new-record-close');
        if (close && typeof close.focus === 'function') {
            this._layout.focused = true;
            close.focus();
        }
    }

    get heading() {
        return `New ${this.objectLabel || 'record'}`;
    }

    get whereText() {
        return this.fieldLabel
            ? `When it is saved, it goes in ${this.fieldLabel} as an unsaved change.`
            : 'When it is saved, it goes in the cell as an unsaved change.';
    }

    handleSuccess(event) {
        const id = event.detail && event.detail.id;
        if (id) this.dispatchEvent(new CustomEvent('created', { detail: { id } }));
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

    /** Shift+Tab from the first control: round to the last the form offers. */
    handleGuardStart() {
        const form = this.template.querySelector('.rh-new-record-form');
        if (form && typeof form.focus === 'function') form.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const close = this.template.querySelector('.rh-new-record-close');
        if (close && typeof close.focus === 'function') close.focus();
    }
}
