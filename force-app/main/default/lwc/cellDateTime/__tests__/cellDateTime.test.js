/**
 * The date/time editor: a box the cell's width with a calendar and a
 * time list below it. The value is an instant, ISO in UTC from end to end; it
 * is shown and edited as the wall clock in a time zone, the user's Salesforce
 * one unless `timeZone` says otherwise. Jest's stand-ins: locale en-US, time
 * zone America/Los_Angeles, weeks from Sunday.
 */
import { createElement } from 'lwc';
import CellDateTime, { REQUIRED_MESSAGE, invalidMessage } from 'c/cellDateTime';

const NEW_YORK = 'America/New_York';
const KOLKATA = 'Asia/Kolkata';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const mount = props => {
    const el = createElement('rowhouse-cell-date-time', { is: CellDateTime });
    Object.assign(el, { mode: 'edit', label: 'Meeting', ...props });
    document.body.appendChild(el);
    return el;
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
const day = (el, iso) => $(el, `td[data-iso="${iso}"]`);
// Some versions of Intl put a narrow space before AM and PM; read it as a space.
const words = text => String(text).replace(/\s/g, ' ');
const box = el => words($(el, 'input').value);
const key = (node, k, extra = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...extra });
    node.dispatchEvent(event);
    return event;
};
const type = (el, text) => {
    const input = $(el, 'input');
    input.value = text;
    input.dispatchEvent(new CustomEvent('input'));
};
const pickTime = (el, hhmm) => {
    const select = $(el, 'select.rh-time');
    select.value = hhmm;
    select.dispatchEvent(new CustomEvent('change'));
};
const commits = el => {
    const handler = jest.fn();
    el.addEventListener('commit', handler);
    return handler;
};
const committed = handler => handler.mock.calls.map(c => c[0].detail.value);

describe('date/time cell', () => {
    beforeEach(() => {
        // Only the clock: 30 Sep 2026, noon in California. Timers stay real.
        jest.useFakeTimers({
            now: new Date('2026-09-30T19:00:00Z'),
            doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask']
        });
    });
    afterEach(() => {
        jest.useRealTimers();
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('shows an instant in the user’s locale and time zone', async () => {
        const el = mount({ mode: 'display', value: '2026-10-01T17:30:00.000Z' });
        await flush();
        expect(words($(el, 'span').textContent)).toBe('10/1/2026, 10:30 AM');
        expect($(el, 'input')).toBeNull();
        expect($(el, 'table')).toBeNull();
    });

    it('opens with the calendar on the value’s day and the time list on its time', async () => {
        const el = mount({ value: '2026-10-01T17:30:00.000Z' });
        await flush();
        expect(box(el)).toBe('10/1/2026, 10:30 AM');
        expect($(el, '.rh-month').textContent).toBe('October');
        expect($(el, 'select.rh-year').value).toBe('2026');
        const chosen = day(el, '2026-10-01');
        expect(chosen.classList).toContain('slds-is-selected');
        expect(chosen.getAttribute('aria-selected')).toBe('true');
        expect(chosen.getAttribute('tabindex')).toBe('0');
        expect($$(el, 'td[aria-selected="true"]')).toHaveLength(1);
        expect($(el, 'select.rh-time').value).toBe('10:30');
        // The zone as people say it, for the chosen day.
        expect($(el, '.rh-zone').textContent).toBe('Time zone: Pacific Daylight Time');
    });

    it('offers a time every 30 minutes, and the value’s own time when it falls between', async () => {
        const el = mount({ value: '2026-10-01T17:10:00.000Z' }); // 10:10 AM in California
        await flush();
        const values = $$(el, 'select.rh-time option').map(o => o.value);
        expect(values).toHaveLength(49);
        expect(values.slice(0, 2)).toEqual(['00:00', '00:30']);
        expect(values.slice(20, 23)).toEqual(['10:00', '10:10', '10:30']);
        expect($(el, 'select.rh-time').value).toBe('10:10');
    });

    it('with no value, shows this month, an empty box and no time', async () => {
        const el = mount({ value: null });
        await flush();
        expect($(el, 'input').value).toBe('');
        expect($(el, '.rh-month').textContent).toBe('September');
        expect(day(el, '2026-09-30').classList).toContain('slds-is-today');
        expect($$(el, 'td[aria-selected="true"]')).toHaveLength(0);
        expect($(el, 'select.rh-time').value).toBe('');
        expect(words($$(el, 'select.rh-time option')[0].textContent)).toBe('—');
    });

    describe('in the time zone it is given', () => {
        it('shows the wall clock there: the calendar, the time list, the box and the note', async () => {
            // 8 PM in UTC on 30 September is half past one in the morning of 1 October in Kolkata.
            const el = mount({ value: '2026-09-30T20:00:00.000Z', timeZone: KOLKATA });
            await flush();
            expect(day(el, '2026-10-01').getAttribute('aria-selected')).toBe('true');
            expect($(el, '.rh-month').textContent).toBe('October');
            expect($(el, 'select.rh-time').value).toBe('01:30');
            expect(box(el)).toBe('10/1/2026, 1:30 AM');
            expect($(el, '.rh-zone').textContent).toBe('Time zone: India Standard Time');
            const shown = mount({ mode: 'display', value: '2026-09-30T20:00:00.000Z', timeZone: KOLKATA });
            await flush();
            expect(words($(shown, 'span').textContent)).toBe('10/1/2026, 1:30 AM');
        });

        it('with no value, today is today there', async () => {
            // Noon in California on 30 September is half past midnight on 1 October in Kolkata.
            const el = mount({ value: null, timeZone: KOLKATA });
            await flush();
            expect($(el, '.rh-month').textContent).toBe('October');
            expect(day(el, '2026-10-01').classList).toContain('slds-is-today');
            expect(day(el, '2026-09-30').classList).not.toContain('slds-is-today');
            const handler = commits(el);
            pickTime(el, '09:00');
            await flush();
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-10-01T03:30:00.000Z']);
        });

        it.each([
            [NEW_YORK, '2026-10-01', '17:30', '2026-10-01T21:30:00.000Z'],
            [KOLKATA, '2026-10-01', '17:30', '2026-10-01T12:00:00.000Z'],
            [KOLKATA, '2026-10-01', '01:00', '2026-09-30T19:30:00.000Z']
        ])('in %s, %s at %s is the instant %s', async (timeZone, iso, hhmm, instant) => {
            const el = mount({ value: null, timeZone });
            await flush();
            const handler = commits(el);
            day(el, iso).click();
            await flush();
            pickTime(el, hhmm);
            await flush();
            expect(handler).not.toHaveBeenCalled();
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual([instant]);
        });

        it('keeps the wall-clock time across a daylight saving change', async () => {
            // 5:30 PM on 31 October is daylight time in New York (UTC-4); on
            // 2 November, after the clocks go back, it is standard time (UTC-5).
            const el = mount({ value: '2026-10-31T21:30:00.000Z', timeZone: NEW_YORK });
            await flush();
            expect($(el, 'select.rh-time').value).toBe('17:30');
            const handler = commits(el);
            day(el, '2026-11-02').click();
            await flush();
            expect($(el, 'select.rh-time').value).toBe('17:30');
            expect(box(el)).toBe('11/2/2026, 5:30 PM');
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-11-02T22:30:00.000Z']);
        });

        it('takes the first of the two in the hour the clocks repeat', async () => {
            const el = mount({ value: null, timeZone: NEW_YORK });
            await flush();
            const handler = commits(el);
            type(el, '11/1/2026, 1:30 AM');
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-11-01T05:30:00.000Z']); // 1:30 AM daylight time
        });

        it('a typed date and time is the wall clock in that zone', async () => {
            const el = mount({ value: null, timeZone: KOLKATA });
            await flush();
            const handler = commits(el);
            type(el, '10/1/2026, 5:30 PM');
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-10-01T12:00:00.000Z']);
        });
    });

    describe('picking from the calendar and the time list', () => {
        it('a click on a day changes the date, keeps the time and leaves the editor open', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' }); // 10:30 AM in California
            await flush();
            const handler = commits(el);
            const cancel = jest.fn();
            el.addEventListener('cancel', cancel);
            day(el, '2026-10-15').click();
            await flush();
            expect(handler).not.toHaveBeenCalled();
            expect(cancel).not.toHaveBeenCalled();
            expect($(el, 'table')).not.toBeNull();
            expect(day(el, '2026-10-15').getAttribute('aria-selected')).toBe('true');
            expect(day(el, '2026-10-01').getAttribute('aria-selected')).toBe('false');
            expect(box(el)).toBe('10/15/2026, 10:30 AM');
            expect($(el, 'select.rh-time').value).toBe('10:30');
            key($(el, 'input'), 'Tab');
            expect(committed(handler)).toEqual(['2026-10-15T17:30:00.000Z']);
        });

        it('a day picked for a blank value starts at noon', async () => {
            const el = mount({ value: null, timeZone: KOLKATA });
            await flush();
            const handler = commits(el);
            day(el, '2026-10-01').click();
            await flush();
            expect($(el, 'select.rh-time').value).toBe('12:00');
            expect(box(el)).toBe('10/1/2026, 12:00 PM');
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-10-01T06:30:00.000Z']);
        });

        it('a time picked changes the time, keeps the date and leaves the editor open', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            pickTime(el, '15:00');
            await flush();
            expect(handler).not.toHaveBeenCalled();
            expect(box(el)).toBe('10/1/2026, 3:00 PM');
            expect(day(el, '2026-10-01').getAttribute('aria-selected')).toBe('true');
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-10-01T22:00:00.000Z']);
        });

        it('a time picked with no day yet goes on today', async () => {
            const el = mount({ value: null });
            await flush();
            const handler = commits(el);
            pickTime(el, '09:00');
            await flush();
            expect(day(el, '2026-09-30').getAttribute('aria-selected')).toBe('true');
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-09-30T16:00:00.000Z']);
        });

        it('Enter or Space on a day in the calendar picks it, and still leaves the editor open', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            key(day(el, '2026-10-01'), 'ArrowRight');
            await flush();
            expect(el.shadowRoot.activeElement.dataset.iso).toBe('2026-10-02');
            const enter = key(day(el, '2026-10-02'), 'Enter');
            await flush();
            expect(enter.defaultPrevented).toBe(true);
            expect(handler).not.toHaveBeenCalled();
            expect(day(el, '2026-10-02').getAttribute('aria-selected')).toBe('true');
            key(day(el, '2026-10-02'), 'Tab');
            expect(committed(handler)).toEqual(['2026-10-02T17:30:00.000Z']);
        });

        it('Down arrow from the box goes into the calendar', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            el.focus();
            key($(el, 'input'), 'ArrowDown');
            await flush();
            expect(el.shadowRoot.activeElement.dataset.iso).toBe('2026-10-01');
        });

        it('the month arrows and the year list move the calendar, not the value', async () => {
            const el = mount({ value: '2026-12-31T20:00:00.000Z' });
            await flush();
            const handler = commits(el);
            $(el, '.rh-next-month').click();
            await flush();
            expect($(el, '.rh-month').textContent).toBe('January');
            expect($(el, 'select.rh-year').value).toBe('2027');
            const year = $(el, 'select.rh-year');
            year.value = '2030';
            year.dispatchEvent(new CustomEvent('change'));
            await flush();
            expect($(el, 'table').getAttribute('aria-label')).toBe('January 2030');
            expect(box(el)).toBe('12/31/2026, 12:00 PM');
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-12-31T20:00:00.000Z']);
        });

        it('a mousedown on the calendar keeps focus in the box, but not on the year or time lists', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            const down = target => {
                const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
                target.dispatchEvent(event);
                return event.defaultPrevented;
            };
            expect(down($(el, 'td[data-iso="2026-10-15"] .slds-day'))).toBe(true);
            expect(down($(el, '.rh-now'))).toBe(true);
            expect(down($(el, 'select.rh-year'))).toBe(false);
            expect(down($(el, 'select.rh-time'))).toBe(false);
        });
    });

    describe('Now', () => {
        it('sets today and the time now, to the minute, and leaves the editor open', async () => {
            jest.setSystemTime(new Date('2026-09-30T19:07:42.500Z'));
            const el = mount({ value: '2020-01-01T00:00:00.000Z', timeZone: KOLKATA });
            await flush();
            const handler = commits(el);
            $(el, '.rh-now').click();
            await flush();
            expect(handler).not.toHaveBeenCalled();
            // 12:37 AM on 1 October in Kolkata.
            expect(day(el, '2026-10-01').getAttribute('aria-selected')).toBe('true');
            expect($(el, '.rh-month').textContent).toBe('October');
            expect($(el, 'select.rh-time').value).toBe('00:37');
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-09-30T19:07:00.000Z']);
        });
    });

    describe('typing', () => {
        it.each([
            ['10/1/2026, 5:30 PM', '2026-10-02T00:30:00.000Z'],
            ['10/1/2026 5:30 PM', '2026-10-02T00:30:00.000Z'],
            ['2026-10-01 17:30', '2026-10-02T00:30:00.000Z'],
            ['2026-10-01T17:30', '2026-10-02T00:30:00.000Z'],
            ['2026-10-01T17:30:00.000Z', '2026-10-01T17:30:00.000Z'],
            ['2026-10-01T17:30:00+02:00', '2026-10-01T15:30:00.000Z'],
            ['10/1/2026', '2026-10-01T07:00:00.000Z']
        ])('reads "%s" as %s', async (text, instant) => {
            const el = mount({ value: null });
            await flush();
            const handler = commits(el);
            type(el, text);
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual([instant]);
        });

        it('a typed date moves the calendar to it', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            type(el, '12/25/2026, 9:00 AM');
            await flush();
            expect($(el, '.rh-month').textContent).toBe('December');
            expect(day(el, '2026-12-25').getAttribute('tabindex')).toBe('0');
        });

        it('what is typed wins over what was picked', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            day(el, '2026-10-15').click();
            await flush();
            type(el, '10/20/2026, 8:00 AM');
            key($(el, 'input'), 'Tab');
            expect(committed(handler)).toEqual(['2026-10-20T15:00:00.000Z']);
        });

        it('refuses what is not a date and time, says so, and keeps the editor open', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            type(el, '13/45/2026, 5:30 PM');
            key($(el, 'input'), 'Enter');
            await flush();
            expect(handler).not.toHaveBeenCalled();
            expect(el.commit()).toBe(false);
            expect(words($(el, '.rh-editor-error').textContent)).toBe(invalidMessage('9/30/2026, 12:00 PM'));
            expect($(el, 'input').getAttribute('aria-invalid')).toBe('true');
            expect($(el, '.slds-form-element').classList).toContain('slds-has-error');
            type(el, '10/1/2026, 25:00');
            expect(el.commit()).toBe(false);
            // A day picked still works, and clears the message.
            day(el, '2026-10-02').click();
            await flush();
            expect($(el, '.rh-editor-error')).toBeNull();
            key($(el, 'input'), 'Enter');
            expect(committed(handler)).toEqual(['2026-10-02T17:30:00.000Z']);
        });
    });

    describe('committing and cancelling', () => {
        it('commits the value unchanged when nothing was typed or picked', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            key($(el, 'input'), 'Tab');
            expect(committed(handler)).toEqual(['2026-10-01T17:30:00.000Z']);
        });

        it('an emptied box commits a blank, unless the field is required', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            type(el, '');
            expect(el.commit()).toBe(true);
            expect(committed(handler)).toEqual([null]);

            const required = mount({ value: '2026-10-01T17:30:00.000Z', required: true });
            await flush();
            const refused = commits(required);
            type(required, '');
            key($(required, 'input'), 'Enter');
            await flush();
            expect(refused).not.toHaveBeenCalled();
            expect(required.commit()).toBe(false);
            expect($(required, '.rh-editor-error').textContent).toBe(REQUIRED_MESSAGE);
            expect($(required, 'input').getAttribute('aria-required')).toBe('true');
        });

        it('refuses a required field with no value even when nothing was typed', async () => {
            const el = mount({ value: null, required: true });
            await flush();
            const handler = commits(el);
            expect(el.commit()).toBe(false);
            await flush();
            expect(handler).not.toHaveBeenCalled();
            expect($(el, '[role="alert"]').textContent).toBe(REQUIRED_MESSAGE);
        });

        it('Escape leaves the cell as it was, whatever was typed or picked', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            const cancel = jest.fn();
            el.addEventListener('cancel', cancel);
            day(el, '2026-10-15').click();
            await flush();
            const escape = key($(el, 'input'), 'Escape');
            expect(escape.defaultPrevented).toBe(true);
            expect(cancel).toHaveBeenCalledTimes(1);
            expect(handler).not.toHaveBeenCalled();
            await flush();
            expect(box(el)).toBe('10/1/2026, 10:30 AM');
            // Escape from the calendar too.
            key(day(el, '2026-10-01'), 'Escape');
            expect(cancel).toHaveBeenCalledTimes(2);
        });

        it('keys it uses do not reach the table', async () => {
            const el = mount({ value: '2026-10-01T17:30:00.000Z' });
            await flush();
            const outside = jest.fn();
            el.addEventListener('keydown', outside);
            key(day(el, '2026-10-01'), 'ArrowRight');
            key($(el, 'input'), 'ArrowDown');
            key($(el, 'input'), 'Enter');
            key($(el, 'input'), 'Tab');
            key($(el, 'input'), 'Escape');
            expect(outside).not.toHaveBeenCalled();
        });
    });

    it('hangs the calendar from the box’s left edge, or its right, and opens upwards when told', async () => {
        const el = mount({ value: '2026-10-01T17:30:00.000Z' });
        await flush();
        const panel = () => $(el, '.slds-datepicker');
        expect(panel().classList).toContain('slds-dropdown_left');
        expect(panel().classList).not.toContain('slds-dropdown_bottom');
        el.dropdownAlign = 'right';
        el.dropdownUp = true;
        await flush();
        expect(panel().classList).toContain('slds-dropdown_right');
        expect(panel().classList).not.toContain('slds-dropdown_left');
        expect(panel().classList).toContain('slds-dropdown_bottom');
    });
});
