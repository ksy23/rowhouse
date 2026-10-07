/**
 * cellDateTime — display and edit for Date/Time fields.
 *
 * A Date/Time is an instant. The value is ISO in UTC from end to end
 * ("2026-10-01T17:30:00.000Z"); it is shown, and edited, as the wall clock in
 * the user's SALESFORCE time zone (TC-029..031), which need not be the
 * computer's, so every conversion names the zone (c/gridCalendar) and never
 * uses the browser's own.
 *
 * THE EDITOR
 * A box the cell's width, showing the date and time in the user's locale,
 * and under it the date editor's calendar and a time list every 30
 * minutes. Unlike the date editor, a day or a time picked from them changes
 * the box and leaves the editor open, so the other half can be set too; Enter
 * or Tab commits, Escape cancels, a click elsewhere commits, as everywhere.
 *   - Keyboard: type a date and time in the box, in the locale's order or ISO
 *     ("10/1/2026, 5:30 PM", "2026-10-01 17:30"), and press Enter; a date
 *     alone is that day's midnight. Down arrow goes into the calendar, whose
 *     keys are the date editor's; Enter or Space there picks the day.
 *   - Now sets today's date and the time now, to the minute.
 *   - A mousedown anywhere on the calendar but the year and time lists keeps
 *     focus in the box, so the table does not take it for leaving the editor.
 * The calendar is cellDate's markup and logic, kept in step by hand: a shared
 * child component would put the days behind one more shadow boundary, which
 * the calendar's focus handling depends on not being there.
 */
import { LightningElement, api } from 'lwc';
import LOCALE from '@salesforce/i18n/locale';
import TIME_ZONE from '@salesforce/i18n/timeZone';
import FIRST_DAY_OF_WEEK from '@salesforce/i18n/firstDayOfWeek';
import { formatDateTime } from 'c/gridFormat';
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
    firstDayFromSalesforce,
    timeOptions,
    instantToZoned,
    zonedToInstant,
    formatTimeOfDay
} from 'c/gridCalendar';

export const REQUIRED_MESSAGE = 'Complete this field.';
export const invalidMessage = example => `Enter a valid date and time, such as ${example}.`;

const FIRST_DAY = firstDayFromSalesforce(FIRST_DAY_OF_WEEK);
const DATETIME_COLUMN = { type: 'datetime' };
const DAY_STEPS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const STEP = 30;
/** When a day is picked for a value that has no time yet: noon, which no time zone turns into another day. */
const NOON = { hour: 12, minute: 0, second: 0 };
const pad = n => String(n).padStart(2, '0');

/**
 * A date and time as the grid shows it (c/gridFormat), but in the editor's
 * time zone, so the box always agrees with the calendar and the time list.
 * c/gridFormat shows the user's Salesforce zone, which is the editor's own
 * unless a test gives it another.
 */
function formatIn(value, timeZone) {
    const instant = value ? new Date(value) : null;
    if (timeZone === TIME_ZONE || !instant || Number.isNaN(instant.getTime())) return formatDateTime(value);
    return new Intl.DateTimeFormat(LOCALE, {
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone
    }).format(instant);
}

export default class CellDateTime extends LightningElement {
    @api value;
    @api mode = 'display';
    @api label = '';
    @api required = false;
    @api dropdownAlign = 'left';
    @api dropdownUp = false;
    /** The time zone to show and edit in; the user's Salesforce one unless a test says otherwise. */
    @api timeZone = TIME_ZONE;

    /** The instant being built by the calendar and the time list (ISO); undefined until one is used. */
    draft;
    /** What is typed in the box, until it is committed; undefined when nothing is. */
    typed;
    /** The day the calendar shows and the keyboard is on (ISO date); undefined until moved. */
    active;
    error = '';

    @api
    focus() {
        const input = this.template.querySelector('input');
        if (input) input.focus();
    }

    get isEdit() {
        return this.mode === 'edit';
    }

    /** Today in the editor's time zone (ISO date). */
    get today() {
        return todayIn(this.timeZone);
    }

    get text() {
        return formatIn(this.value, this.timeZone);
    }

    /** The instant the editor holds: picked, else the value. */
    get current() {
        return this.draft !== undefined ? this.draft : this.value;
    }

    /** { date, hour, minute } of the current instant in the zone, or null. */
    get wall() {
        return this.current ? instantToZoned(this.current, this.timeZone) : null;
    }

    get inputText() {
        return this.typed !== undefined ? this.typed : formatIn(this.current, this.timeZone);
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

    /**
     * The zone the time is in, as people say it ("Pacific Daylight Time"), for
     * the chosen day, or the zone's id where the browser has no name for it.
     */
    get zoneText() {
        let name = this.timeZone;
        try {
            const at = this.current ? new Date(this.current) : new Date();
            const part = new Intl.DateTimeFormat(LOCALE, { timeZone: this.timeZone, timeZoneName: 'long' })
                .formatToParts(Number.isNaN(at.getTime()) ? new Date() : at)
                .find(p => p.type === 'timeZoneName');
            if (part && part.value) name = part.value;
        } catch {
            // An id the browser does not know: show it as it is.
        }
        return `Time zone: ${name}`;
    }

    // ---------------------------------------------------------- the calendar

    get chosen() {
        const wall = this.wall;
        return wall ? wall.date : null;
    }

    get activeIso() {
        return this.active || this.chosen || this.today;
    }

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

    /** The time list: every 30 minutes, and the current time if it falls between. */
    get times() {
        const wall = this.wall;
        const at = wall ? `${pad(wall.hour)}:${pad(wall.minute)}` : null;
        const list = timeOptions(LOCALE, STEP);
        if (at && !list.some(o => o.value === at)) {
            list.push({ value: at, hour: wall.hour, minute: wall.minute, label: formatTimeOfDay(LOCALE, wall) });
            list.sort((a, b) => (a.value < b.value ? -1 : 1));
        }
        const out = list.map(o => ({ value: o.value, label: o.label, selected: o.value === at }));
        if (!at) out.unshift({ value: '', label: '—', selected: true });
        return out;
    }

    renderedCallback() {
        // The lists follow the editor: an option's `selected` only sets a list's first choice.
        const year = this.template.querySelector('select.rh-year');
        if (year && this.view && year.value !== String(this.view.year)) year.value = String(this.view.year);
        const time = this.template.querySelector('select.rh-time');
        const wall = this.wall;
        const at = wall ? `${pad(wall.hour)}:${pad(wall.minute)}` : '';
        if (time && time.value !== at) time.value = at;
    }

    // -------------------------------------------------------------- handlers

    handleInput(event) {
        this.typed = event.target.value;
        this.error = '';
        const parsed = parseCell(this.typed, DATETIME_COLUMN, LOCALE, this.timeZone);
        if (parsed.value) {
            const wall = instantToZoned(parsed.value, this.timeZone);
            if (wall) this.active = wall.date;
        }
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
            this.pickDay(from);
            return;
        } else {
            return; // Tab and Escape are the editor's, below
        }
        event.preventDefault();
        event.stopPropagation();
        const to = parseIso(next);
        if (to.month !== this.view.month || to.year !== this.view.year) {
            const grid = this.template.querySelector('table');
            if (grid) grid.focus(); // see cellDate: focus waits on the calendar while the days are redrawn
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
            this.draft = undefined;
            this.error = '';
            this.dispatchEvent(new CustomEvent('cancel'));
        }
    }

    /** Keep focus where it is, except for the year and time lists, which open only with it. */
    handleCalendarMouseDown(event) {
        const tag = event.target && event.target.tagName;
        if (tag === 'SELECT' || tag === 'OPTION') return;
        event.preventDefault();
    }

    handleDayClick(event) {
        this.pickDay(event.currentTarget.dataset.iso);
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

    handleTimeChange(event) {
        const [hour, minute] = String(event.target.value).split(':').map(Number);
        if (!Number.isInteger(hour)) return;
        const date = this.chosen || this.activeIso;
        this.set(date, { hour, minute, second: 0 });
    }

    handleNow() {
        const wall = instantToZoned(new Date().toISOString(), this.timeZone);
        this.active = wall.date;
        this.set(wall.date, { hour: wall.hour, minute: wall.minute, second: 0 });
    }

    focusActiveDay() {
        Promise.resolve().then(() => {
            const day = this.template.querySelector('td[data-iso][tabindex="0"]');
            if (day) day.focus();
        });
    }

    /** A day picked: the date changes, the time stays (noon when there is none yet). */
    pickDay(iso) {
        const wall = this.wall;
        this.active = iso;
        this.set(iso, wall ? { hour: wall.hour, minute: wall.minute, second: wall.second } : NOON);
    }

    set(dateIso, time) {
        const instant = zonedToInstant(dateIso, time, this.timeZone);
        if (!instant) return;
        this.draft = instant;
        this.typed = undefined;
        this.error = '';
    }

    // ---------------------------------------------------------------- commit

    /**
     * Commit what the box holds: what was typed if anything was, else what
     * was picked, else the value as it was. A required field left blank, or a
     * box that does not hold a date and time, is refused here with a message;
     * the editor stays open. Returns whether the value was committed.
     */
    @api
    commit() {
        let value = this.current;
        if (this.typed !== undefined) {
            const parsed = parseCell(this.typed, DATETIME_COLUMN, LOCALE, this.timeZone);
            if (parsed.error) {
                this.error = invalidMessage(formatDateTime(new Date().toISOString()));
                return false;
            }
            value = parsed.value;
        }
        if (this.required && !value) {
            this.error = REQUIRED_MESSAGE;
            return false;
        }
        this.typed = undefined;
        this.draft = undefined;
        this.error = '';
        this.dispatchEvent(new CustomEvent('commit', { detail: { value: value || null } }));
        return true;
    }
}
