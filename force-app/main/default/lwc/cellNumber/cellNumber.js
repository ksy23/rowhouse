/**
 * cellNumber — display and edit for number, currency and percent fields.
 *
 * TC-024: an 18-digit value exceeds Number.MAX_SAFE_INTEGER and arrives from
 * Apex as a string. It stays a string all the way through display, edit and save.
 * TC-025: Salesforce stores 50 for 50%. The editor uses lightning-input's
 * "percent-fixed" formatter, which takes the stored number as-is, so nothing is
 * ever multiplied or divided by 100.
 * TC-023: a typed value with more decimals than the field allows is rounded
 * to the field's scale on commit, exactly and half up, so the cell shows what
 * will be saved. The input accepts any number of decimals, as Lightning's own
 * record form does, rather than flagging the extra digits as an error. A value
 * the user did not touch is committed unchanged: opening and closing the editor
 * must never rewrite a stored value that already has more decimals.
 */
import { LightningElement, api } from 'lwc';
import { formatNumber, toSafeNumeric, roundDecimal, isBlank } from 'c/gridFormat';

export const REQUIRED_MESSAGE = 'Complete this field.';

export default class CellNumber extends LightningElement {
    @api value;
    @api mode = 'display';
    @api label = '';
    @api type = 'number'; // number | currency | percent
    @api scale;
    @api required = false;
    /** The character the user typed on the cell to start editing. */
    @api seed;

    draft;
    error = '';

    connectedCallback() {
        if (this.seed !== undefined && this.seed !== null) this.draft = String(this.seed);
    }

    /** The value the editor works with: a number when safe, a string when not. */
    @api
    get editValue() {
        return isBlank(this.value) ? null : toSafeNumeric(this.value);
    }

    @api
    focus() {
        const input = this.template.querySelector('lightning-input');
        if (input) input.focus();
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    get text() {
        return formatNumber(this.value, { type: this.type, scale: this.scale });
    }

    get formatter() {
        if (this.type === 'currency') return 'currency';
        if (this.type === 'percent') return 'percent-fixed';
        return 'decimal';
    }

    get step() {
        return 'any';
    }

    get inputValue() {
        if (this.draft !== undefined) return this.draft;
        return isBlank(this.value) ? '' : String(this.value);
    }

    handleChange(event) {
        this.draft = event.detail.value;
        this.error = '';
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
        let value = this.draft !== undefined ? this.draft : this.value;
        // An emptied input is null, never '' — a number field has no empty string.
        if (value === '') value = null;
        if (this.required && isBlank(value)) {
            this.error = REQUIRED_MESSAGE;
            return false;
        }
        this.error = '';
        // TC-026: accept a grouped entry ("1,234,567.89") as well as a plain one.
        if (typeof value === 'string') value = value.replace(/,/g, '').trim();
        const typed = this.draft !== undefined;
        this.draft = undefined;
        if (typed && value !== null) value = roundDecimal(value, this.scale);
        this.dispatchEvent(
            new CustomEvent('commit', { detail: { value: value === null ? null : toSafeNumeric(value) } })
        );
        return true;
    }
}
