/**
 * cellCheckbox — display and edit for Checkbox fields.
 *
 * TC-042: a checkbox is never null in Salesforce. A null that reaches this
 * component (a new row, a field the user cannot read) is shown and saved as
 * false, never as a third state.
 *
 * Native <input type="checkbox"> in SLDS checkbox markup rather than
 * lightning-input: one element per cell instead of a component tree, and the
 * native control already has the keyboard behaviour (Space toggles).
 *
 * ONE CLICK, AS IN A SPREADSHEET
 * Ticking the box is the edit: the change is committed at once, so the cell
 * shows it and the Save bar appears. Before, a mouse click did nothing: the
 * visible box is the label's, which cannot take focus, so the browser moved
 * focus from the input to the table cell on mousedown; the editor saw focus
 * leave, committed the value it still had, and closed before the click could
 * tick the box (found in Lightning Experience). A mousedown in the
 * editor now keeps focus on the input; the click still ticks it.
 */
import { LightningElement, api } from 'lwc';

export default class CellCheckbox extends LightningElement {
    @api value;
    @api mode = 'display';
    @api label = '';

    draft;

    @api
    focus() {
        const input = this.template.querySelector('input');
        if (input) input.focus();
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    get checked() {
        const v = this.draft !== undefined ? this.draft : this.value;
        return v === true || v === 'true';
    }

    get stateText() {
        return this.checked ? 'Checked' : 'Not checked';
    }

    /** Ticked or cleared, by mouse or Space: that is the edit (see above). */
    handleChange(event) {
        this.draft = event.target.checked;
        this.commit();
    }

    /** Keep focus on the input: a click on the label must not take it away first. */
    handleMouseDown(event) {
        event.preventDefault();
        this.focus();
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
            this.dispatchEvent(new CustomEvent('cancel'));
        }
    }

    @api
    commit() {
        const value = this.checked;
        this.draft = undefined;
        this.dispatchEvent(new CustomEvent('commit', { detail: { value } }));
    }
}
