/**
 * The time editor: a box the cell's width with a list of times every
 * 30 minutes below it. A Time has no time zone, so "17:30:00.000Z" is half
 * past five for everyone. Jest's stand-ins: locale en-US.
 */
import { createElement } from 'lwc';
import CellTime, { REQUIRED_MESSAGE, INVALID_MESSAGE, STEP } from 'c/cellTime';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const mount = props => {
    const el = createElement('rowhouse-cell-time', { is: CellTime });
    Object.assign(el, { mode: 'edit', label: 'Start Time', ...props });
    document.body.appendChild(el);
    return el;
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
const option = (el, hhmm) => $(el, `[role="option"][data-value="${hhmm}"]`);
// Some versions of Intl put a narrow space before AM and PM; read it as a space.
const words = text => String(text).replace(/\s/g, ' ');
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

describe('time cell', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    describe('display', () => {
        it('shows a time as the locale writes it, not as Salesforce stores it', async () => {
            const el = mount({ mode: 'display', value: '17:30:00.000Z' });
            await flush();
            expect(words($(el, 'span').textContent)).toBe('5:30 PM');
            expect($(el, 'input')).toBeNull();
            expect($(el, '[role="listbox"]')).toBeNull();
        });

        it('shows the morning and midnight too, and nothing for a blank', async () => {
            const morning = mount({ mode: 'display', value: '09:05:00.000Z' });
            const midnight = mount({ mode: 'display', value: '00:00:00.000Z' });
            const blank = mount({ mode: 'display', value: null });
            await flush();
            expect(words($(morning, 'span').textContent)).toBe('9:05 AM');
            expect(words($(midnight, 'span').textContent)).toBe('12:00 AM');
            expect($(blank, 'span').textContent).toBe('');
        });
    });

    describe('the editor', () => {
        it('opens with the time in the box and a list of times every 30 minutes', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            expect(words($(el, 'input').value)).toBe('5:30 PM');
            const options = $$(el, '[role="option"]');
            expect(STEP).toBe(30);
            expect(options).toHaveLength(48);
            expect(options.slice(0, 3).map(o => o.dataset.value)).toEqual(['00:00', '00:30', '01:00']);
            expect(options[options.length - 1].dataset.value).toBe('23:30');
            expect(words(options[0].textContent)).toBe('12:00 AM');
            expect(words(option(el, '13:30').textContent)).toBe('1:30 PM');
        });

        it('is a labelled combobox that controls the list', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const input = $(el, 'input');
            const list = $(el, '[role="listbox"]');
            expect(input.getAttribute('role')).toBe('combobox');
            expect(input.getAttribute('aria-expanded')).toBe('true');
            expect(input.getAttribute('aria-controls')).toBe(list.getAttribute('id'));
            expect(list.getAttribute('aria-label')).toBe('Times for Start Time');
            expect($(el, 'label').textContent).toBe('Start Time');
        });

        it('opens with the list on the current time: that option is selected and has focus', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const chosen = option(el, '17:30');
            expect(chosen.getAttribute('aria-selected')).toBe('true');
            expect(chosen.classList).toContain('slds-is-selected');
            expect(chosen.classList).toContain('slds-has-focus');
            expect(chosen.getAttribute('tabindex')).toBe('0');
            expect($$(el, '[aria-selected="true"]')).toHaveLength(1);
            expect($$(el, '[role="option"][tabindex="0"]')).toHaveLength(1);
        });

        it('for a time between two options, opens on the one before it, with nothing selected', async () => {
            const el = mount({ value: '17:45:00.000Z' });
            await flush();
            expect(option(el, '17:30').getAttribute('tabindex')).toBe('0');
            expect(option(el, '17:30').classList).toContain('slds-has-focus');
            expect($$(el, '[aria-selected="true"]')).toHaveLength(0);
        });

        it('with no value, opens on 9:00 AM, the start of a working day', async () => {
            const el = mount({ value: null });
            await flush();
            expect($(el, 'input').value).toBe('');
            expect(option(el, '09:00').getAttribute('tabindex')).toBe('0');
            expect($$(el, '[aria-selected="true"]')).toHaveLength(0);
        });

        it('a typed time moves the list to it', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            type(el, '8am');
            await flush();
            expect(option(el, '08:00').getAttribute('aria-selected')).toBe('true');
            expect(option(el, '08:00').getAttribute('tabindex')).toBe('0');
            expect(option(el, '17:30').getAttribute('aria-selected')).toBe('false');
        });
    });

    describe('committing', () => {
        it.each([
            ['17:30', '17:30:00.000Z'],
            ['5:30 PM', '17:30:00.000Z'],
            ['5:30pm', '17:30:00.000Z'],
            ['5pm', '17:00:00.000Z'],
            ['17:30:15', '17:30:15.000Z'],
            ['12 am', '00:00:00.000Z'],
            ['12:30 PM', '12:30:00.000Z'],
            ['9:05', '09:05:00.000Z']
        ])('reads "%s" and commits %s on Enter', async (text, value) => {
            const el = mount({ value: '08:00:00.000Z' });
            await flush();
            const handler = commits(el);
            type(el, text);
            const enter = key($(el, 'input'), 'Enter');
            expect(enter.defaultPrevented).toBe(true);
            expect(committed(handler)).toEqual([value]);
        });

        it('commits a typed time on Tab too', async () => {
            const el = mount({ value: '08:00:00.000Z' });
            await flush();
            const handler = commits(el);
            type(el, '5:30 PM');
            const tab = key($(el, 'input'), 'Tab');
            expect(tab.defaultPrevented).toBe(true);
            expect(committed(handler)).toEqual(['17:30:00.000Z']);
        });

        it('commits the value unchanged when nothing was typed', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            key($(el, 'input'), 'Tab');
            expect(committed(handler)).toEqual(['17:30:00.000Z']);
        });

        it('refuses what is not a time, says so, and keeps the editor open', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            for (const text of ['lunch', '25:00', '13pm', '17:75']) {
                type(el, text);
                key($(el, 'input'), 'Enter');
                // eslint-disable-next-line no-await-in-loop
                await flush();
                expect(handler).not.toHaveBeenCalled();
                expect($(el, '.rh-editor-error').textContent).toBe(INVALID_MESSAGE);
            }
            expect(el.commit()).toBe(false);
            expect($(el, 'input').getAttribute('aria-invalid')).toBe('true');
            expect($(el, '.slds-form-element').classList).toContain('slds-has-error');
            // Typing again clears the message; a good time then commits.
            type(el, '6pm');
            await flush();
            expect($(el, '.rh-editor-error')).toBeNull();
            expect($(el, 'input').getAttribute('aria-invalid')).toBeNull();
            expect(el.commit()).toBe(true);
            expect(committed(handler)).toEqual(['18:00:00.000Z']);
        });

        it('an emptied box commits a blank, unless the field is required', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            type(el, '   ');
            expect(el.commit()).toBe(true);
            expect(committed(handler)).toEqual([null]);

            const required = mount({ value: '17:30:00.000Z', required: true });
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
            key($(el, 'input'), 'Tab');
            await flush();
            expect(handler).not.toHaveBeenCalled();
            expect($(el, '[role="alert"]').textContent).toBe(REQUIRED_MESSAGE);
        });

        it('Escape leaves the cell as it was', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            const cancel = jest.fn();
            el.addEventListener('cancel', cancel);
            type(el, '9am');
            await flush();
            const escape = key($(el, 'input'), 'Escape');
            expect(escape.defaultPrevented).toBe(true);
            expect(cancel).toHaveBeenCalledTimes(1);
            expect(handler).not.toHaveBeenCalled();
            await flush();
            // What was typed is gone: the box shows the value again.
            expect(words($(el, 'input').value)).toBe('5:30 PM');
        });

        it('keys it uses do not reach the table', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const outside = jest.fn();
            el.addEventListener('keydown', outside);
            key($(el, 'input'), 'Enter');
            key($(el, 'input'), 'ArrowDown');
            key($(el, 'input'), 'Tab');
            key($(el, 'input'), 'Escape');
            await flush();
            key(option(el, '17:30'), 'ArrowDown');
            expect(outside).not.toHaveBeenCalled();
        });
    });

    describe('the list', () => {
        it('a click on a time commits it', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            option(el, '09:30').click();
            expect(committed(handler)).toEqual(['09:30:00.000Z']);
        });

        it('a click on a time wins over what was typed', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const handler = commits(el);
            type(el, 'not a time');
            option(el, '13:00').click();
            expect(committed(handler)).toEqual(['13:00:00.000Z']);
        });

        it('a mousedown on the list keeps focus in the box', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
            option(el, '09:30').dispatchEvent(down);
            expect(down.defaultPrevented).toBe(true);
        });

        describe('keyboard', () => {
            const focused = el => el.shadowRoot.activeElement && el.shadowRoot.activeElement.dataset.value;

            it('Down arrow from the box goes to the current time in the list', async () => {
                const el = mount({ value: '17:30:00.000Z' });
                await flush();
                el.focus();
                expect(el.shadowRoot.activeElement).toBe($(el, 'input'));
                key($(el, 'input'), 'ArrowDown');
                await flush();
                expect(focused(el)).toBe('17:30');
            });

            it('arrows move one option, Home and End go to the ends, and moving chooses nothing', async () => {
                const el = mount({ value: '17:30:00.000Z' });
                await flush();
                const handler = commits(el);
                key(option(el, '17:30'), 'ArrowDown');
                await flush();
                expect(focused(el)).toBe('18:00');
                key(option(el, '18:00'), 'ArrowUp');
                key(option(el, '18:00'), 'ArrowUp');
                await flush();
                expect(focused(el)).toBe('17:00');
                key(option(el, '17:00'), 'Home');
                await flush();
                expect(focused(el)).toBe('00:00');
                key(option(el, '00:00'), 'ArrowUp'); // stays at the top
                await flush();
                expect(focused(el)).toBe('00:00');
                key(option(el, '00:00'), 'End');
                await flush();
                expect(focused(el)).toBe('23:30');
                key(option(el, '23:30'), 'ArrowDown'); // stays at the bottom
                await flush();
                expect(focused(el)).toBe('23:30');
                expect($$(el, '[role="option"][tabindex="0"]')).toHaveLength(1);
                expect(handler).not.toHaveBeenCalled();
                expect(option(el, '17:30').getAttribute('aria-selected')).toBe('true');
            });

            it('Enter or Space picks the time the keyboard is on', async () => {
                const el = mount({ value: '17:30:00.000Z' });
                await flush();
                const handler = commits(el);
                key(option(el, '17:30'), 'ArrowDown');
                await flush();
                const enter = key(option(el, '18:00'), 'Enter');
                expect(enter.defaultPrevented).toBe(true);
                expect(committed(handler)).toEqual(['18:00:00.000Z']);

                const other = mount({ value: '17:30:00.000Z' });
                await flush();
                const picked = commits(other);
                key(option(other, '17:30'), ' ');
                expect(committed(picked)).toEqual(['17:30:00.000Z']);
            });

            it('Tab in the list keeps the box’s value; Escape cancels', async () => {
                const el = mount({ value: '17:30:00.000Z' });
                await flush();
                const handler = commits(el);
                const cancel = jest.fn();
                el.addEventListener('cancel', cancel);
                key(option(el, '17:30'), 'ArrowDown');
                await flush();
                key(option(el, '18:00'), 'Tab');
                expect(committed(handler)).toEqual(['17:30:00.000Z']);
                key(option(el, '18:00'), 'Escape');
                expect(cancel).toHaveBeenCalledTimes(1);
            });
        });

        it('hangs from the box’s left edge, or its right, and opens upwards when told', async () => {
            const el = mount({ value: '17:30:00.000Z' });
            await flush();
            const list = () => $(el, '.rh-time-list');
            expect(list().classList).toContain('slds-dropdown_left');
            expect(list().classList).not.toContain('slds-dropdown_bottom');
            el.dropdownAlign = 'right';
            el.dropdownUp = true;
            await flush();
            expect(list().classList).toContain('slds-dropdown_right');
            expect(list().classList).not.toContain('slds-dropdown_left');
            expect(list().classList).toContain('slds-dropdown_bottom');
        });
    });
});
