/**
 * cellTime — display and edit for Time fields.
 *
 * A Time has no time zone: "17:30:00.000Z", as Salesforce writes it, is half
 * past five for everyone, the Z notwithstanding. Cells show it in the user's
 * locale ("5:30 PM").
 *
 * THE EDITOR
 * A box the cell's width, and under it a list of times every 30 minutes, as
 * Salesforce's own time picker offers, scrolled to the time in the box.
 *   - Mouse: a click on a time sets it and closes the editor.
 *   - Keyboard: type a time ("17:30", "5:30 PM", "5pm") and press Enter; Down
 *     arrow goes into the list, where the arrows move, Home and End go to the
 *     ends, and Enter or Space picks. Tab keeps what is in the box and Escape
 *     leaves the cell as it was, as in every editor.
 *   - A mousedown on the list keeps focus in the box (as the date editor's
 *     calendar does): focus leaving the box would look to the table like
 *     leaving the editor.
 * The list hangs below the box like a menu and opens leftwards or upwards when
 * the table says there is no room (`dropdownAlign`, `dropdownUp`).
 */
import { LightningElement, api } from 'lwc';
import LOCALE from '@salesforce/i18n/locale';
import { formatTime } from 'c/gridFormat';
import { parseTimeText, timeValue, timeOptions } from 'c/gridCalendar';

export const REQUIRED_MESSAGE = 'Complete this field.';
/** What the box says when what is typed is not a time. */
export const INVALID_MESSAGE = 'Enter a valid time, such as 5:30 PM or 17:30.';
/** Minutes between the times the list offers. */
export const STEP = 30;

const OPTIONS = timeOptions(LOCALE, STEP);

export default class CellTime extends LightningElement {
    @api value;
    @api mode = 'display';
    @api label = '';
    @api required = false;
    @api dropdownAlign = 'left';
    @api dropdownUp = false;

    /** What is typed in the box, until it is committed; undefined when nothing is. */
    typed;
    /** The list's option the keyboard is on ("HH:MM"); undefined until moved. */
    active;
    error = '';
    // Non-reactive (HR-20): whether the list has been scrolled to the time yet.
    _layout = { scrolled: false };

    @api
    focus() {
        const input = this.template.querySelector('input');
        if (input) input.focus();
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    get text() {
        return formatTime(this.value);
    }

    get inputText() {
        return this.typed !== undefined ? this.typed : formatTime(this.value);
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

    get listLabel() {
        return `Times for ${this.label}`;
    }

    get dropdownClass() {
        return (
            'slds-dropdown ' +
            (this.dropdownAlign === 'right' ? 'slds-dropdown_right' : 'slds-dropdown_left') +
            (this.dropdownUp ? ' slds-dropdown_bottom' : '') +
            ' rh-time-list'
        );
    }

    /** The time the box holds ("HH:MM"), or null. */
    get chosen() {
        const t = parseTimeText(this.typed !== undefined ? this.typed : this.value);
        return t ? `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}` : null;
    }

    /** The option nearest at or before the time in the box, so the list opens there. */
    get nearest() {
        const chosen = this.chosen;
        if (!chosen) return OPTIONS[Math.floor((9 * 60) / STEP)].value; // 9:00 AM, a working day's start
        let at = OPTIONS[0].value;
        OPTIONS.forEach(o => {
            if (o.value <= chosen) at = o.value;
        });
        return at;
    }

    get options() {
        const chosen = this.chosen;
        const active = this.active || this.nearest;
        return OPTIONS.map(o => ({
            ...o,
            selected: o.value === chosen ? 'true' : 'false',
            tabIndex: o.value === active ? '0' : '-1',
            cls:
                'slds-media slds-listbox__option slds-listbox__option_plain slds-media_small' +
                (o.value === chosen ? ' slds-is-selected' : '') +
                (o.value === active ? ' slds-has-focus' : '')
        }));
    }

    renderedCallback() {
        // The list opens scrolled to the time in the box, not to midnight.
        if (this._layout.scrolled || !this.isEdit) return;
        const option = this.template.querySelector('[role="option"][tabindex="0"]');
        const list = this.template.querySelector('.rh-time-list');
        if (option && list) {
            list.scrollTop = Math.max(0, option.offsetTop - list.clientHeight / 2);
            this._layout.scrolled = true;
        }
    }

    handleInput(event) {
        this.typed = event.target.value;
        this.error = '';
        this.active = undefined;
    }

    handleInputKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this.commit();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            this.focusActive();
        }
    }

    handleListKeyDown(event) {
        const values = OPTIONS.map(o => o.value);
        const from = values.indexOf(this.active || this.nearest);
        let to;
        if (event.key === 'ArrowDown') to = Math.min(values.length - 1, from + 1);
        else if (event.key === 'ArrowUp') to = Math.max(0, from - 1);
        else if (event.key === 'Home') to = 0;
        else if (event.key === 'End') to = values.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            this.pick(values[from]);
            return;
        } else {
            return; // Tab and Escape are the editor's, below
        }
        event.preventDefault();
        event.stopPropagation();
        this.active = values[to];
        this.focusActive();
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
            this.typed = undefined;
            this.error = '';
            this.dispatchEvent(new CustomEvent('cancel'));
        }
    }

    /** Keep focus in the editor while the list is clicked: see the header. */
    handleListMouseDown(event) {
        event.preventDefault();
    }

    handleOptionClick(event) {
        this.pick(event.currentTarget.dataset.value);
    }

    focusActive() {
        if (!this.active) this.active = this.nearest;
        // LWC redraws in a microtask queued by the change above; this one runs after it.
        Promise.resolve().then(() => {
            const option = this.template.querySelector('[role="option"][tabindex="0"]');
            if (option) option.focus();
        });
    }

    pick(hhmm) {
        const t = parseTimeText(hhmm);
        this.typed = undefined;
        if (t) this.send(timeValue(t));
    }

    /**
     * Commit what the box holds. A required field left blank, or a box that
     * does not hold a time, is refused here, with a message; the editor stays
     * open. Returns whether the value was committed.
     */
    @api
    commit() {
        let value = this.value;
        if (this.typed !== undefined) {
            if (!this.typed.trim()) {
                value = null;
            } else {
                const t = parseTimeText(this.typed);
                if (!t) {
                    this.error = INVALID_MESSAGE;
                    return false;
                }
                value = timeValue(t);
            }
        }
        return this.send(value);
    }

    send(value) {
        if (this.required && !value) {
            this.error = REQUIRED_MESSAGE;
            return false;
        }
        this.typed = undefined;
        this.error = '';
        this.dispatchEvent(new CustomEvent('commit', { detail: { value: value || null } }));
        return true;
    }
}
