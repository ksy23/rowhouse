/**
 * cellText — display and edit for text-like fields (text, email, phone, url).
 *
 * Part of the cell-editor library. It imports nothing from the table (HR-27), so
 * it can be used on its own. Values render through template text bindings only —
 * never innerHTML — so markup in a value is shown as text (TC-017 / TC-018).
 */
import { LightningElement, api } from 'lwc';
import { codePointLength, safeHref, isBlank } from 'c/gridFormat';

export const REQUIRED_MESSAGE = 'Complete this field.';

export default class CellText extends LightningElement {
    @api value;
    @api mode = 'display';
    @api label = '';
    @api type = 'text';
    @api maxLength;
    @api required = false;
    /** The character the user typed on the cell to start editing: the new value so far. */
    @api seed;

    draft;
    error = '';

    connectedCallback() {
        if (this.seed !== undefined && this.seed !== null) this.draft = String(this.seed);
    }

    /** TC-012: characters as a person counts them — code points, not UTF-16 units. */
    @api
    get displayLength() {
        return codePointLength(this.value);
    }

    /** TC-001 / TC-002: null is "no value"; '' is a value, even if empty. */
    @api
    get isNull() {
        return this.value === null || this.value === undefined;
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
        return this.isNull ? '' : String(this.value);
    }

    /** TC-046: only schemes that cannot execute become links. */
    get href() {
        return this.type === 'url' ? safeHref(this.value) : null;
    }

    get inputType() {
        return { email: 'email', phone: 'tel', url: 'url' }[this.type] || 'text';
    }

    get inputValue() {
        return this.draft !== undefined ? this.draft : this.text;
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
        // TC-005: whitespace is preserved exactly as typed — no trim.
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
