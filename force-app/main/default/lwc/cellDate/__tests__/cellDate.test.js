/**
 * The date editor: a box the cell's width with the calendar open below it.
 * Dates stay ISO strings (TC-027, TC-028). Jest's stand-ins:
 * locale en-US, timezone America/Los_Angeles, weeks from Sunday.
 */
import { createElement } from 'lwc';
import CellDate, { REQUIRED_MESSAGE, invalidMessage } from 'c/cellDate';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const mount = props => {
    const el = createElement('rowhouse-cell-date', { is: CellDate });
    Object.assign(el, { mode: 'edit', label: 'Close Date', ...props });
    document.body.appendChild(el);
    return el;
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
const day = (el, iso) => $(el, `td[data-iso="${iso}"]`);
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
const commits = el => {
    const handler = jest.fn();
    el.addEventListener('commit', handler);
    return handler;
};
const committed = handler => handler.mock.calls.map(c => c[0].detail.value);

describe('date cell', () => {
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

    it('TC-027: shows a date as the locale writes it, with no day shift', async () => {
        const el = mount({ mode: 'display', value: '2026-01-01' });
        await flush();
        expect($(el, 'span').textContent).toBe('1/1/2026');
        expect($(el, 'table')).toBeNull();
    });

    it('opens with the calendar showing, on the value’s month, the value chosen', async () => {
        const el = mount({ value: '2026-11-22' });
        await flush();
        expect($(el, 'input').value).toBe('11/22/2026');
        expect($(el, '.slds-datepicker')).not.toBeNull();
        expect($(el, '.rh-month').textContent).toBe('November');
        expect($(el, 'select').value).toBe('2026');
        expect($(el, 'table').getAttribute('aria-label')).toBe('November 2026');
        const chosen = day(el, '2026-11-22');
        expect(chosen.classList).toContain('slds-is-selected');
        expect(chosen.getAttribute('aria-selected')).toBe('true');
        expect(chosen.getAttribute('tabindex')).toBe('0');
        expect(chosen.getAttribute('aria-label')).toBe('Sunday, November 22, 2026');
        expect($$(el, 'td[aria-selected="true"]')).toHaveLength(1);
        // Six weeks, and days of the months either side marked as such.
        expect($$(el, 'td[data-iso]')).toHaveLength(42);
        expect(day(el, '2026-11-01').classList).not.toContain('slds-day_adjacent-month');
        expect(day(el, '2026-12-05').classList).toContain('slds-day_adjacent-month');
    });

    it('starts the week on the locale’s first day, named in the locale', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        expect($$(el, 'th abbr').map(a => a.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        expect($$(el, 'th abbr')[0].title).toBe('Sunday');
        expect($(el, 'td[data-iso]').dataset.iso).toBe('2026-08-30');
    });

    it('with no value, shows this month in the user’s timezone and marks today', async () => {
        const el = mount({ value: null });
        await flush();
        expect($(el, 'input').value).toBe('');
        expect($(el, '.rh-month').textContent).toBe('September');
        const today = day(el, '2026-09-30');
        expect(today.classList).toContain('slds-is-today');
        expect(today.getAttribute('aria-current')).toBe('date');
        expect(today.getAttribute('tabindex')).toBe('0');
        expect($$(el, 'td[aria-selected="true"]')).toHaveLength(0);
    });

    it('a click on a day sets it and closes the editor', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        const handler = commits(el);
        day(el, '2026-09-15').click();
        expect(committed(handler)).toEqual(['2026-09-15']);
    });

    it('a mousedown on the calendar keeps focus in the box, but not on the year list', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        const down = target => {
            const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
            target.dispatchEvent(event);
            return event.defaultPrevented;
        };
        expect(down($(el, 'td[data-iso="2026-09-15"] .slds-day'))).toBe(true);
        expect(down($(el, '.rh-month'))).toBe(true);
        expect(down($(el, '.rh-today'))).toBe(true);
        expect(down($(el, '.rh-next-month'))).toBe(true);
        expect(down($(el, 'select'))).toBe(false);
    });

    it('the arrows beside the month and the year list move the calendar', async () => {
        const el = mount({ value: '2026-12-31' });
        await flush();
        $(el, '.rh-next-month').click();
        await flush();
        expect($(el, '.rh-month').textContent).toBe('January');
        expect($(el, 'select').value).toBe('2027');
        $(el, '.rh-previous-month').click();
        $(el, '.rh-previous-month').click();
        await flush();
        expect($(el, '.rh-month').textContent).toBe('November');
        const select = $(el, 'select');
        select.value = '2030';
        select.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect($(el, 'table').getAttribute('aria-label')).toBe('November 2030');
        // Moving the calendar is not choosing: the value is still the same day.
        expect($(el, 'input').value).toBe('12/31/2026');
    });

    it('Today picks today', async () => {
        const el = mount({ value: '2020-01-01' });
        await flush();
        const handler = commits(el);
        $(el, '.rh-today').click();
        expect(committed(handler)).toEqual(['2026-09-30']);
    });

    it('a typed date moves the calendar, and Enter commits it', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        const handler = commits(el);
        type(el, '10/5/2026');
        await flush();
        expect($(el, '.rh-month').textContent).toBe('October');
        expect(day(el, '2026-10-05').classList).toContain('slds-is-selected');
        key($(el, 'input'), 'Enter');
        expect(committed(handler)).toEqual(['2026-10-05']);
    });

    it('follows a date typed a character at a time, never losing the calendar', async () => {
        // "1/5/202" on the way to "1/5/2027" once gave a year of 202 and the
        // calendar a null month: a component error in Lightning Experience.
        const el = mount({ value: null });
        await flush();
        const handler = commits(el);
        for (const text of ['1', '1/', '1/5', '1/5/', '1/5/2', '1/5/20', '1/5/202', '1/5/2027']) {
            type(el, text);
            // eslint-disable-next-line no-await-in-loop
            await flush();
            expect($(el, '.rh-month').textContent).toBeTruthy();
            expect($$(el, 'td[data-iso]')).toHaveLength(42);
        }
        expect($(el, 'table').getAttribute('aria-label')).toBe('January 2027');
        key($(el, 'input'), 'Enter');
        expect(committed(handler)).toEqual(['2027-01-05']);
    });

    it('refuses a year a Date field cannot hold', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        const handler = commits(el);
        type(el, '1/5/202');
        expect(el.commit()).toBe(false);
        expect(handler).not.toHaveBeenCalled();
    });

    it('takes a typed ISO date too', async () => {
        const el = mount({ value: null });
        await flush();
        const handler = commits(el);
        type(el, '2027-02-14');
        key($(el, 'input'), 'Tab');
        expect(committed(handler)).toEqual(['2027-02-14']);
    });

    it('refuses what is not a date, and keeps the editor open', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        const handler = commits(el);
        type(el, '13/45/2026');
        key($(el, 'input'), 'Enter');
        await flush();
        expect(handler).not.toHaveBeenCalled();
        expect(el.commit()).toBe(false);
        expect($(el, '.rh-editor-error').textContent).toBe(invalidMessage('9/30/2026'));
        expect($(el, 'input').getAttribute('aria-invalid')).toBe('true');
        expect($(el, '.slds-form-element').classList).toContain('slds-has-error');
        // The calendar stays where it was; a click on a day still works.
        expect($(el, '.rh-month').textContent).toBe('September');
        day(el, '2026-09-01').click();
        expect(committed(handler)).toEqual(['2026-09-01']);
    });

    it('an emptied box commits a blank, unless the field is required', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        const handler = commits(el);
        type(el, '');
        expect(el.commit()).toBe(true);
        expect(committed(handler)).toEqual([null]);

        const required = mount({ value: '2026-09-30', required: true });
        await flush();
        const refused = commits(required);
        type(required, '');
        expect(required.commit()).toBe(false);
        await flush();
        expect(refused).not.toHaveBeenCalled();
        expect($(required, '.rh-editor-error').textContent).toBe(REQUIRED_MESSAGE);
        expect($(required, 'input').getAttribute('aria-required')).toBe('true');
    });

    it('commits the value unchanged when nothing was typed or picked', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        const handler = commits(el);
        key($(el, 'input'), 'Tab');
        expect(committed(handler)).toEqual(['2026-09-30']);
    });

    it('Escape leaves the cell as it was', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        const cancel = jest.fn();
        const handler = commits(el);
        el.addEventListener('cancel', cancel);
        type(el, '1/1/2020');
        const event = key($(el, 'input'), 'Escape');
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(handler).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
    });

    describe('keyboard in the calendar', () => {
        const active = el => el.shadowRoot.activeElement && el.shadowRoot.activeElement.dataset.iso;

        it('Down arrow from the box goes to the chosen day', async () => {
            const el = mount({ value: '2026-09-30' });
            await flush();
            el.focus();
            expect(el.shadowRoot.activeElement).toBe($(el, 'input'));
            key($(el, 'input'), 'ArrowDown');
            await flush();
            expect(active(el)).toBe('2026-09-30');
        });

        it('arrows move a day or a week, and the calendar follows into the next month', async () => {
            const el = mount({ value: '2026-09-30' });
            await flush();
            key(day(el, '2026-09-30'), 'ArrowRight');
            await flush();
            expect(active(el)).toBe('2026-10-01');
            expect($(el, '.rh-month').textContent).toBe('October');
            key(day(el, '2026-10-01'), 'ArrowUp');
            await flush();
            expect(active(el)).toBe('2026-09-24');
            key(day(el, '2026-09-24'), 'ArrowLeft');
            await flush();
            expect(active(el)).toBe('2026-09-23');
            key(day(el, '2026-09-23'), 'ArrowDown');
            await flush();
            expect(active(el)).toBe('2026-09-30');
            expect($$(el, 'td[tabindex="0"]')).toHaveLength(1);
        });

        it('Page Up and Page Down move a month, with Shift a year; Home and End the week', async () => {
            const el = mount({ value: '2026-01-31' });
            await flush();
            key(day(el, '2026-01-31'), 'PageDown');
            await flush();
            expect(active(el)).toBe('2026-02-28');
            key(day(el, '2026-02-28'), 'PageUp');
            await flush();
            expect(active(el)).toBe('2026-01-28');
            key(day(el, '2026-01-28'), 'PageDown', { shiftKey: true });
            await flush();
            expect(active(el)).toBe('2027-01-28');
            expect($(el, 'select').value).toBe('2027');
            key(day(el, '2027-01-28'), 'Home'); // a Thursday
            await flush();
            expect(active(el)).toBe('2027-01-24');
            key(day(el, '2027-01-24'), 'End');
            await flush();
            expect(active(el)).toBe('2027-01-30');
        });

        it('a move into another month keeps focus on the calendar while the days are redrawn', async () => {
            // In a browser, focus on a day that is redrawn away is lost, and the
            // table takes that for leaving the editor (found in Lightning Experience).
            const el = mount({ value: '2026-09-15' });
            await flush();
            const grid = $(el, 'table');
            const hop = jest.spyOn(grid, 'focus');
            key(day(el, '2026-09-15'), 'ArrowRight'); // the same month: straight to the next day
            await flush();
            expect(hop).not.toHaveBeenCalled();
            key(day(el, '2026-09-16'), 'PageDown');
            expect(hop).toHaveBeenCalledTimes(1); // before the redraw
            expect(grid.getAttribute('tabindex')).toBe('-1');
            await flush();
            expect(active(el)).toBe('2026-10-16');
        });

        it('Enter or Space picks the day; moving alone changes nothing', async () => {
            const el = mount({ value: '2026-09-30' });
            await flush();
            const handler = commits(el);
            key(day(el, '2026-09-30'), 'ArrowLeft');
            await flush();
            expect(handler).not.toHaveBeenCalled();
            expect(day(el, '2026-09-30').classList).toContain('slds-is-selected');
            const enter = key(day(el, '2026-09-29'), 'Enter');
            expect(enter.defaultPrevented).toBe(true);
            expect(committed(handler)).toEqual(['2026-09-29']);

            const other = mount({ value: '2026-09-30' });
            await flush();
            const picked = commits(other);
            key(day(other, '2026-09-30'), ' ');
            expect(committed(picked)).toEqual(['2026-09-30']);
        });

        it('keys it uses do not reach the table', async () => {
            const el = mount({ value: '2026-09-30' });
            await flush();
            const outside = jest.fn();
            el.addEventListener('keydown', outside);
            key(day(el, '2026-09-30'), 'ArrowRight');
            key($(el, 'input'), 'ArrowDown');
            key($(el, 'input'), 'Enter');
            expect(outside).not.toHaveBeenCalled();
        });

        it('Tab in the calendar keeps the box’s value; Escape cancels', async () => {
            const el = mount({ value: '2026-09-30' });
            await flush();
            const handler = commits(el);
            const cancel = jest.fn();
            el.addEventListener('cancel', cancel);
            key(day(el, '2026-09-30'), 'ArrowRight');
            await flush();
            key(day(el, '2026-10-01'), 'Tab');
            expect(committed(handler)).toEqual(['2026-09-30']);
            key(day(el, '2026-10-01'), 'Escape');
            expect(cancel).toHaveBeenCalledTimes(1);
        });
    });

    it('hangs the calendar from the box’s left edge, or its right when told', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        expect($(el, '.slds-datepicker').classList).toContain('slds-dropdown_left');
        el.dropdownAlign = 'right';
        await flush();
        expect($(el, '.slds-datepicker').classList).toContain('slds-dropdown_right');
        expect($(el, '.slds-datepicker').classList).not.toContain('slds-dropdown_left');
    });

    it('opens the calendar above the box when told there is no room below it', async () => {
        const el = mount({ value: '2026-09-30' });
        await flush();
        expect($(el, '.slds-datepicker').classList).not.toContain('slds-dropdown_bottom');
        el.dropdownUp = true;
        await flush();
        expect($(el, '.slds-datepicker').classList).toContain('slds-dropdown_bottom');
        expect($(el, '.slds-datepicker').classList).toContain('slds-dropdown_left');
    });
});
