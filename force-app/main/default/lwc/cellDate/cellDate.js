/**
 * cellDate — display and edit for Date fields.
 *
 * A Date has no timezone (TC-027 / TC-028). The value is the ISO string
 * "YYYY-MM-DD" from end to end; it is never turned into a JavaScript Date in the
 * user's local time, which is the bug that shifts a date by a day. The date
 * arithmetic is in c/gridCalendar.
 *
 * THE CALENDAR OPENS WITH THE EDITOR
 * Editing a date shows a text box the width of the cell and, under it, a
 * calendar in Salesforce's own look (the SLDS datepicker), in the user's
 * locale: month and weekday names, and the first day of the week. Before, the
 * editor was lightning-input's date field, whose calendar opens only on a
 * click on its icon; it cannot be opened from code (checked in Lightning
 * Experience: focus and the arrow keys do not open it).
 *   - Mouse: a click on a day sets the date and closes the editor, which puts
 *     the change on the Save bar. The arrows beside the month and the year
 *     list move the calendar; Today picks today.
 *   - Keyboard: type a date in the box (the locale's order, or YYYY-MM-DD)
 *     and press Enter; the calendar follows what is typed. Down arrow goes
 *     into the calendar, where the arrows move a day or a week, Page Up and
 *     Page Down a month (with Shift, a year), Home and End the start and end
 *     of the week, and Enter or Space picks the day. Tab keeps what is in the
 *     box and Escape leaves the cell as it was, as in every editor.
 *   - A mousedown anywhere on the calendar but the year list keeps focus
 *     in the box: focus moving to a day or the background would look to the
 *     table like leaving the editor, which commits and closes it before the
 *     click lands (the bug found in the checkbox editor the same day).
 * The box keeps the cell's width; the calendar hangs below it like a menu and
 * opens leftwards when the table says there is no room to its right
 * (`dropdownAlign`).
 */
import { LightningElement, api } from 'lwc';
import LOCALE from '@salesforce/i18n/locale';
import TIME_ZONE from '@salesforce/i18n/timeZone';
import FIRST_DAY_OF_WEEK from '@salesforce/i18n/firstDayOfWeek';
import { formatDate } from 'c/gridFormat';
import { parseCell } from 'c/gridClipboard';
import {
    parseIso,
    addDays,
    addMonths,
    startOfWeek,
    endOfWeek,
    monthWeeks,
    weekdayNames,
    monthName,
    longDate,
    todayIn,
    yearRange,
    firstDayFromSalesforce
} from 'c/gridCalendar';

export const REQUIRED_MESSAGE = 'Complete this field.';
/** What the box says when what is typed is not a date. */
export const invalidMessage = example => `Enter a valid date, such as ${example}.`;

const FIRST_DAY = firstDayFromSalesforce(FIRST_DAY_OF_WEEK);
const DATE_COLUMN = { type: 'date' };
// Keys the calendar grid moves by: days.
const DAY_STEPS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

export default class CellDate extends LightningElement {
    @api value;
    @api mode = 'display';
    @api label = '';
    @api required = false;
    /** 'left' (the default) or 'right': which edge of the box the calendar hangs from. */
    @api dropdownAlign = 'left';
    /** true: the calendar opens above the box, when the table says there is no room below it. */
    @api dropdownUp = false;

    /** What is typed in the box, until it is committed; undefined when nothing is. */
    typed;
    /** The day the calendar shows and the keyboard is on (ISO); undefined until moved. */
    active;
    error = '';
    today = todayIn(TIME_ZONE);

    @api
    focus() {
        const input = this.template.querySelector('input');
        if (input) input.focus();
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    get text() {
        return formatDate(this.value);
    }

    // --------------------------------------------------------------- the box

    get inputText() {
        return this.typed !== undefined ? this.typed : formatDate(this.value);
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

    // ---------------------------------------------------------- the calendar

    /** The date the box holds: what is typed if it is a date, else the value. */
    get chosen() {
        const value = this.typed !== undefined ? parseCell(this.typed, DATE_COLUMN, LOCALE).value : this.value;
        return parseIso(value) ? value : null;
    }

    get activeIso() {
        return this.active || this.chosen || this.today;
    }

    /** { year, month, day } of the day the calendar shows; never null, or the calendar could not draw. */
    get view() {
        return parseIso(this.activeIso) || parseIso(this.today);
    }

    get dropdownClass() {
        return 'slds-datepicker slds-dropdown ' + (this.dropdownAlign === 'right' ? 'slds-dropdown_right' : 'slds-dropdown_left')
            + (this.dropdownUp ? ' slds-dropdown_bottom' : '') + ' rh-calendar';
    }

    get monthLabel() {
        return monthName(LOCALE, this.view.year, this.view.month);
    }

    get gridLabel() {
        return `${this.monthLabel} ${this.view.year}`;
    }

    get years() {
        const current = this.view.year;
        return yearRange(current).map(y => ({ value: String(y), selected: y === current }));
    }

    get weekdays() {
        return weekdayNames(LOCALE, FIRST_DAY).map((d, i) => ({ key: 'd' + i, ...d }));
    }

    get weeks() {
        const { year, month } = this.view;
        const chosen = this.chosen;
        const active = this.activeIso;
        const today = this.today;
        return monthWeeks(year, month, FIRST_DAY).map((week, w) => ({
            key: 'w' + w,
            days: week.map(d => {
                const cls = [];
                if (!d.inMonth) cls.push('slds-day_adjacent-month');
                if (d.iso === today) cls.push('slds-is-today');
                if (d.iso === chosen) cls.push('slds-is-selected');
                return {
                    key: d.iso,
                    iso: d.iso,
                    day: d.day,
                    cls: cls.join(' '),
                    selected: d.iso === chosen ? 'true' : 'false',
                    current: d.iso === today ? 'date' : null,
                    tabIndex: d.iso === active ? '0' : '-1',
                    label: longDate(LOCALE, d.iso)
                };
            })
        }));
    }

    renderedCallback() {
        // The year list follows the calendar. A DOM property, not component
        // state: an option's `selected` only sets the list's first choice.
        const select = this.template.querySelector('select');
        if (select && this.view && select.value !== String(this.view.year)) select.value = String(this.view.year);
    }

    // -------------------------------------------------------------- handlers

    handleInput(event) {
        this.typed = event.target.value;
        this.error = '';
        // The calendar follows a typed date; anything else leaves it where it is.
        const chosen = this.chosen;
        if (chosen) this.active = chosen;
    }

    handleInputKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this.commit();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            this.focusActiveDay();
        }
    }

    handleGridKeyDown(event) {
        const from = this.activeIso;
        let next;
        if (DAY_STEPS[event.key] !== undefined) next = addDays(from, DAY_STEPS[event.key]);
        else if (event.key === 'PageUp') next = addMonths(from, event.shiftKey ? -12 : -1);
        else if (event.key === 'PageDown') next = addMonths(from, event.shiftKey ? 12 : 1);
        else if (event.key === 'Home') next = startOfWeek(from, FIRST_DAY);
        else if (event.key === 'End') next = endOfWeek(from, FIRST_DAY);
        else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            this.pick(from);
            return;
        } else {
            return; // Tab and Escape are the editor's, below
        }
        event.preventDefault();
        event.stopPropagation();
        // A move into another month redraws the days, and the focused one may
        // go: focus on a removed element is simply lost, which the table takes
        // for leaving the editor, and commits and closes it (found in
        // Lightning Experience: Page Down closed the editor). So focus waits
        // on the calendar itself, which stays, until the new day is drawn.
        const to = parseIso(next);
        if (to.month !== this.view.month || to.year !== this.view.year) {
            const grid = this.template.querySelector('table');
            if (grid) grid.focus();
        }
        this.active = next;
        this.focusActiveDay();
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

    /**
     * Keep focus where it is: see the header. The click still lands, on a
     * day, an arrow or Today. The year list is the exception: it opens only
     * if it takes focus, and it is inside the editor, so that is safe.
     */
    handleCalendarMouseDown(event) {
        const tag = event.target && event.target.tagName;
        if (tag === 'SELECT' || tag === 'OPTION') return;
        event.preventDefault();
    }

    handleDayClick(event) {
        this.pick(event.currentTarget.dataset.iso);
    }

    handleToday() {
        this.pick(this.today);
    }

    handlePreviousMonth() {
        this.active = addMonths(this.activeIso, -1);
    }

    handleNextMonth() {
        this.active = addMonths(this.activeIso, 1);
    }

    handleYearChange(event) {
        this.active = addMonths(this.activeIso, (Number(event.target.value) - this.view.year) * 12);
    }

    /** Focus the day the keyboard is on, once the calendar shows it. */
    focusActiveDay() {
        // LWC redraws in a microtask queued by the change above; this one runs after it.
        Promise.resolve().then(() => {
            const day = this.template.querySelector('td[data-iso][tabindex="0"]');
            if (day) day.focus();
        });
    }

    pick(iso) {
        this.typed = undefined;
        this.active = iso;
        this.send(iso);
    }

    // ---------------------------------------------------------------- commit

    /**
     * Commit what the box holds. A required field left blank, or a box that
     * does not hold a date, is refused here, in the editor, with a message:
     * the editor stays open. Returns whether the value was committed.
     */
    @api
    commit() {
        let value = this.value;
        if (this.typed !== undefined) {
            const parsed = parseCell(this.typed, DATE_COLUMN, LOCALE);
            if (parsed.error || (parsed.value && !parseIso(parsed.value))) {
                this.error = invalidMessage(formatDate(this.today));
                return false;
            }
            value = parsed.value;
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
