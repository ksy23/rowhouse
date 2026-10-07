/**
 * cellTextarea — edit for text areas, long ones included.
 *
 * THE EDITOR
 * A box the cell's width shows the start of the text; a text area hangs below
 * it, wider than a narrow cell and six lines tall, with a count of characters
 * against the field's length. Enter starts a new line, as in any text area;
 * Ctrl+Enter (Cmd+Enter on a Mac), Tab or Done commits; Escape or Cancel
 * leaves the cell as it was; a click elsewhere commits, as in every editor.
 *
 * THE WHOLE TEXT FIRST
 * The grid sends at most the first 1,000 characters of a long value with the
 * rows (TC-055). A cell whose value was shortened (`cut`) must never save that
 * shortened copy, so the editor first reads the whole text
 * (GridController.fetchFullText, for the named grid, the record and the
 * field; the server checks all three) and is read only until it arrives. If
 * it cannot be read, the editor says so and will not commit: the cell keeps
 * its value.
 *
 * Text is never trimmed (TC-005).
 */
import { LightningElement, api } from 'lwc';
import LOCALE from '@salesforce/i18n/locale';
import fetchFullText from '@salesforce/apex/GridController.fetchFullText';
import { isBlank } from 'c/gridFormat';

export const REQUIRED_MESSAGE = 'Complete this field.';
/** Characters the box shows before "…". */
const SUMMARY_LENGTH = 60;

/** An Apex error's message, whatever shape it arrived in. */
function messageOf(error) {
    const body = error && error.body;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    return (error && error.message) || 'Unknown error.';
}

export default class CellTextarea extends LightningElement {
    @api value;
    @api mode = 'display';
    @api label = '';
    @api required = false;
    /** The field's length in characters; the count shows what is left. */
    @api maxLength;
    /** The value in the row was shortened: read the whole text before editing (TC-055). */
    @api cut = false;
    /** For reading the whole text: the grid, the record and the field. */
    @api configName;
    @api recordId;
    @api field;
    @api dropdownAlign = 'left';
    @api dropdownUp = false;

    /** What is typed, until it is committed; undefined when nothing is. */
    draft;
    /** The whole text, once read; undefined when the value was not shortened. */
    whole;
    loading = false;
    error = '';
    /** The whole text could not be read: nothing may be committed. */
    failed = false;

    connectedCallback() {
        if (this.isEdit && this.cut) this.readWhole();
    }

    /**
     * A textarea has no value attribute for the template to bind, so the text
     * is put in here: at first, and when the whole text arrives. What the
     * user types is already there.
     */
    renderedCallback() {
        const area = this.template.querySelector('textarea');
        if (area && area.value !== this.inputText) area.value = this.inputText;
    }

    async readWhole() {
        this.loading = true;
        try {
            const text = await fetchFullText({ configName: this.configName, recordId: this.recordId, field: this.field });
            this.whole = text == null ? '' : text;
            this.failed = false;
        } catch (e) {
            this.failed = true;
            this.error = 'The whole text could not be read, so it cannot be edited here. ' + messageOf(e);
        } finally {
            this.loading = false;
        }
        // The text area was disabled while it loaded; focus it now it can be typed in.
        Promise.resolve().then(() => this.focus());
    }

    @api
    focus() {
        const area = this.template.querySelector('textarea');
        if (area && !area.disabled) area.focus();
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    /** The text before any typing: the whole text when it had to be read, else the value. */
    get original() {
        if (this.whole !== undefined) return this.whole;
        return isBlank(this.value) ? '' : String(this.value);
    }

    get inputText() {
        return this.draft !== undefined ? this.draft : this.original;
    }

    get summary() {
        const text = this.loading ? String(this.value || '') : this.inputText;
        const line = text.replace(/\s+/g, ' ').trim();
        return line.length > SUMMARY_LENGTH ? line.slice(0, SUMMARY_LENGTH) + '…' : line;
    }

    get maxLengthAttr() {
        const n = Number(this.maxLength);
        return Number.isInteger(n) && n > 0 ? n : null;
    }

    get countText() {
        const n = new Intl.NumberFormat(LOCALE);
        const used = [...this.inputText].length;
        const max = this.maxLengthAttr;
        return max ? `${n.format(used)} / ${n.format(max)}` : n.format(used);
    }

    get panelClass() {
        return 'slds-dropdown slds-p-around_small rh-textarea-panel '
            + (this.dropdownAlign === 'right' ? 'slds-dropdown_right' : 'slds-dropdown_left')
            + (this.dropdownUp ? ' slds-dropdown_bottom' : '');
    }

    get formElementClass() {
        return 'slds-form-element' + (this.error ? ' slds-has-error' : '');
    }

    get ariaInvalid() {
        return this.error ? 'true' : null;
    }

    get ariaRequired() {
        return this.required ? 'true' : null;
    }

    handleInput(event) {
        this.draft = event.target.value;
        if (!this.failed) this.error = '';
    }

    /** Enter is a new line here: it must not reach the table, which would move or commit. */
    handleTextKeyDown(event) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.stopPropagation();
            this.commit();
        } else if (event.key === 'Enter') {
            event.stopPropagation();
        }
    }

    /** Tab and Escape, wherever focus is in the editor. */
    handleKeyDown(event) {
        if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            this.commit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.cancel();
        }
    }

    /** The summary box is not a control: a click on it keeps focus in the text area. */
    handleSummaryMouseDown(event) {
        event.preventDefault();
        this.focus();
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
     * Commit the text. Refused, with the editor left open, while the whole
     * text is still loading or could not be read, and for a required field
     * left blank. Returns whether the value was committed.
     */
    @api
    commit() {
        if (this.loading) return false;
        if (this.failed) {
            // Nothing typed here can replace a text that was never read whole.
            this.dispatchEvent(new CustomEvent('cancel'));
            return true;
        }
        if (this.draft === undefined) {
            // Nothing typed: the cell keeps its value. Committing the whole text
            // read for a shortened cell would mark an unchanged cell as edited.
            this.dispatchEvent(new CustomEvent('cancel'));
            return true;
        }
        const value = this.draft;
        if (this.required && isBlank(value)) {
            this.error = REQUIRED_MESSAGE;
            return false;
        }
        this.draft = undefined;
        this.error = '';
        this.dispatchEvent(new CustomEvent('commit', { detail: { value: isBlank(value) ? null : value } }));
        return true;
    }
}
