/**
 * cellPicklist — display and edit for Picklist fields.
 *
 * TC-036: a stored value that is no longer in the active value set is normal in
 * any org more than a year old. It is displayed as stored, offered in the editor
 * as the current selection (marked inactive), and saved back unchanged unless the
 * user picks something else. Blanking it would be silent data loss.
 *
 * TC-039: a dependent picklist whose controlling value has no valid dependents
 * renders as a disabled, empty control — in either mode — rather than throwing
 * or offering values the platform would reject.
 *
 * A native <select> in SLDS select markup, not lightning-combobox: it is one
 * element instead of a component tree per cell, it
 * carries a real `disabled` attribute, and it can show the inactive stored value
 * as an option without fighting the base component's validation.
 */
import { LightningElement, api } from 'lwc';
import { picklistLabel, isBlank } from 'c/gridFormat';

export const REQUIRED_MESSAGE = 'Complete this field.';

export default class CellPicklist extends LightningElement {
    @api value;
    @api mode = 'display';
    @api label = '';
    @api options = [];
    @api dependentOn;
    @api required = false;

    draft;
    error = '';

    @api
    focus() {
        const select = this.template.querySelector('select');
        if (select) select.focus();
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    /** TC-039: nothing valid to choose, so nothing can be chosen. */
    get isUnavailable() {
        return Boolean(this.dependentOn) && !(this.options && this.options.length);
    }

    get showSelect() {
        return this.isEdit || this.isUnavailable;
    }

    get text() {
        return picklistLabel(this.value, this.options);
    }

    get current() {
        return this.draft !== undefined ? this.draft : this.value;
    }

    get optionList() {
        const current = this.current;
        const list = [
            { value: '', label: '--None--', selected: current === null || current === undefined || current === '' }
        ];
        const active = this.options || [];
        active.forEach(o => list.push({ value: o.value, label: o.label, selected: o.value === current }));
        const known = active.some(o => o.value === current);
        if (!known && current !== null && current !== undefined && current !== '') {
            // TC-036: keep the stored value selectable, and say why it looks odd.
            list.push({ value: current, label: current + ' (inactive)', selected: true });
        }
        return list;
    }

    handleChange(event) {
        this.draft = event.target.value === '' ? null : event.target.value;
        this.error = '';
    }

    get formElementClass() {
        return 'slds-form-element' + (this.error ? ' slds-has-error' : '');
    }

    get ariaInvalid() {
        return this.error ? 'true' : null;
    }

    handleKeyDown(event) {
        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            this.commit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.draft = undefined;
            this.error = '';
            this.dispatchEvent(new CustomEvent('cancel'));
        }
    }

    /**
     * A required field left blank is refused here, in the editor, with the
     * message a record form gives: the editor stays open. Returns
     * whether the value was committed.
     */
    @api
    commit() {
        const value = this.draft !== undefined ? this.draft : this.value;
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
