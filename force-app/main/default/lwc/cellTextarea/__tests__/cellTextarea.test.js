/**
 * The text area editor: a box the cell's width showing the start of
 * the text, and a text area below it with a count of characters. Enter is a
 * new line; Ctrl+Enter (Cmd+Enter on a Mac), Tab or Done commits; Escape or
 * Cancel leaves the cell as it was. A value the grid shortened (`cut`) is
 * read whole from the server before it can be edited (TC-055).
 */
import { createElement } from 'lwc';
import CellTextarea, { REQUIRED_MESSAGE } from 'c/cellTextarea';
import fetchFullText from '@salesforce/apex/GridController.fetchFullText';

jest.mock('@salesforce/apex/GridController.fetchFullText', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const mount = props => {
    const el = createElement('rowhouse-cell-textarea', { is: CellTextarea });
    Object.assign(el, { mode: 'edit', label: 'Description', ...props });
    document.body.appendChild(el);
    return el;
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const area = el => $(el, 'textarea');
const key = (node, k, extra = {}) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...extra });
    node.dispatchEvent(event);
    return event;
};
const type = (el, text) => {
    area(el).value = text;
    area(el).dispatchEvent(new CustomEvent('input'));
};
const listen = (el, name) => {
    const handler = jest.fn();
    el.addEventListener(name, handler);
    return handler;
};
const committed = handler => handler.mock.calls.map(c => c[0].detail.value);
const CUT = { cut: true, configName: 'Test_Records', recordId: 'a01000000000001AAA', field: 'Notes__c' };

describe('text area cell', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        jest.clearAllMocks();
    });

    it('shows the value as it is in display mode, and reads nothing from the server', async () => {
        const el = mount({ mode: 'display', value: 'Line one', ...CUT });
        await flush();
        expect($(el, 'span').textContent).toBe('Line one');
        expect(area(el)).toBeNull();
        expect(fetchFullText).not.toHaveBeenCalled();
    });

    describe('the editor', () => {
        it('starts with the value in the text area, new lines and all', async () => {
            const el = mount({ value: 'Line one\nLine two' });
            await flush();
            expect(area(el).value).toBe('Line one\nLine two');
            expect($(el, 'label').textContent).toBe('Description');
            expect(area(el).disabled).toBe(false);
            expect(fetchFullText).not.toHaveBeenCalled();
        });

        it('starts empty for a blank value', async () => {
            const el = mount({ value: null });
            await flush();
            expect(area(el).value).toBe('');
            expect($(el, '.rh-textarea-summary').textContent).toBe('');
        });

        it('shows the start of the text on one line in the box above, and follows what is typed', async () => {
            const long = 'word '.repeat(30);
            const el = mount({ value: 'First line\n\nsecond   line' });
            await flush();
            expect($(el, '.rh-textarea-summary').textContent).toBe('First line second line');
            type(el, long);
            await flush();
            const summary = $(el, '.rh-textarea-summary').textContent;
            expect(summary).toBe(long.trim().slice(0, 60) + '…');
        });

        it('a mousedown on the box above keeps focus in the text area', async () => {
            const el = mount({ value: 'Hello' });
            await flush();
            const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
            $(el, '.rh-textarea-summary').dispatchEvent(down);
            expect(down.defaultPrevented).toBe(true);
            expect(el.shadowRoot.activeElement).toBe(area(el));
        });

        it('counts the characters against the field’s length', async () => {
            const el = mount({ value: 'Hello', maxLength: 255 });
            await flush();
            expect($(el, '.rh-count').textContent).toBe('5 / 255');
            expect(area(el).getAttribute('maxlength')).toBe('255');
            type(el, 'Hello, world');
            await flush();
            expect($(el, '.rh-count').textContent).toBe('12 / 255');
        });

        it('writes a long field’s length the locale’s way, and counts only what is used without one', async () => {
            const el = mount({ value: '', maxLength: 131072 });
            const free = mount({ value: 'abc' });
            await flush();
            expect($(el, '.rh-count').textContent).toBe('0 / 131,072');
            expect($(free, '.rh-count').textContent).toBe('3');
            expect(area(free).getAttribute('maxlength')).toBeNull();
        });

        it('hangs from the box’s left edge, or its right, and opens upwards when told', async () => {
            const el = mount({ value: 'Hello' });
            await flush();
            const panel = () => $(el, '.rh-textarea-panel');
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

    describe('keys', () => {
        it('Enter starts a new line: it does not commit, and does not reach the table', async () => {
            const el = mount({ value: 'Hello' });
            await flush();
            const commit = listen(el, 'commit');
            const cancel = listen(el, 'cancel');
            const outside = listen(el, 'keydown');
            type(el, 'Hello');
            const enter = key(area(el), 'Enter');
            const shiftEnter = key(area(el), 'Enter', { shiftKey: true });
            expect(enter.defaultPrevented).toBe(false); // the new line is typed as usual
            expect(shiftEnter.defaultPrevented).toBe(false);
            expect(outside).not.toHaveBeenCalled();
            expect(commit).not.toHaveBeenCalled();
            expect(cancel).not.toHaveBeenCalled();
        });

        it.each([
            ['Ctrl+Enter', { ctrlKey: true }],
            ['Cmd+Enter', { metaKey: true }]
        ])('%s commits what was typed', async (name, modifier) => {
            const el = mount({ value: 'Hello' });
            await flush();
            const commit = listen(el, 'commit');
            const outside = listen(el, 'keydown');
            type(el, 'Hello\nworld');
            const enter = key(area(el), 'Enter', modifier);
            expect(enter.defaultPrevented).toBe(true);
            expect(outside).not.toHaveBeenCalled();
            expect(committed(commit)).toEqual(['Hello\nworld']);
        });

        it('Tab commits what was typed', async () => {
            const el = mount({ value: 'Hello' });
            await flush();
            const commit = listen(el, 'commit');
            type(el, 'Goodbye');
            const tab = key(area(el), 'Tab');
            expect(tab.defaultPrevented).toBe(true);
            expect(committed(commit)).toEqual(['Goodbye']);
        });

        it('Escape leaves the cell as it was', async () => {
            const el = mount({ value: 'Hello' });
            await flush();
            const commit = listen(el, 'commit');
            const cancel = listen(el, 'cancel');
            const outside = listen(el, 'keydown');
            type(el, 'Goodbye');
            const escape = key(area(el), 'Escape');
            expect(escape.defaultPrevented).toBe(true);
            expect(outside).not.toHaveBeenCalled();
            expect(cancel).toHaveBeenCalledTimes(1);
            expect(commit).not.toHaveBeenCalled();
        });
    });

    describe('committing', () => {
        it('Done commits and Cancel cancels', async () => {
            const el = mount({ value: 'Hello' });
            await flush();
            const commit = listen(el, 'commit');
            const cancel = listen(el, 'cancel');
            type(el, 'Changed');
            $(el, 'button[data-done]').click();
            expect(committed(commit)).toEqual(['Changed']);
            $(el, 'button.slds-button_neutral').click();
            expect(cancel).toHaveBeenCalledTimes(1);
        });

        it('with nothing typed, leaves the cell as it was: a cancel, not a commit', async () => {
            const el = mount({ value: 'Hello' });
            await flush();
            const commit = listen(el, 'commit');
            const cancel = listen(el, 'cancel');
            expect(el.commit()).toBe(true);
            key(area(el), 'Tab');
            expect(commit).not.toHaveBeenCalled();
            expect(cancel).toHaveBeenCalledTimes(2);
        });

        it('never trims the text', async () => {
            const el = mount({ value: 'Hello' });
            await flush();
            const commit = listen(el, 'commit');
            type(el, '  padded  \n');
            expect(el.commit()).toBe(true);
            expect(committed(commit)).toEqual(['  padded  \n']);
        });

        it('an emptied text area commits a blank, unless the field is required', async () => {
            const el = mount({ value: 'Hello' });
            await flush();
            const commit = listen(el, 'commit');
            type(el, '');
            expect(el.commit()).toBe(true);
            expect(committed(commit)).toEqual([null]);

            const required = mount({ value: 'Hello', required: true });
            await flush();
            const refused = listen(required, 'commit');
            type(required, '');
            key(area(required), 'Enter', { ctrlKey: true });
            await flush();
            expect(refused).not.toHaveBeenCalled();
            expect(required.commit()).toBe(false);
            expect($(required, '[role="alert"]').textContent).toBe(REQUIRED_MESSAGE);
            expect(REQUIRED_MESSAGE).toBe('Complete this field.');
            expect(area(required).getAttribute('aria-invalid')).toBe('true');
            expect(area(required).getAttribute('aria-required')).toBe('true');
            expect($(required, '.slds-form-element').classList).toContain('slds-has-error');
            // Typing clears the message.
            type(required, 'Back again');
            await flush();
            expect($(required, '[role="alert"]')).toBeNull();
            expect(required.commit()).toBe(true);
            expect(committed(refused)).toEqual(['Back again']);
        });
    });

    describe('a shortened value (TC-055)', () => {
        const WHOLE = 'A'.repeat(1000) + ' and the rest of the text';

        it('reads the whole text for this grid, record and field, and is read only until it arrives', async () => {
            let arrive;
            fetchFullText.mockImplementation(
                () =>
                    new Promise(resolve => {
                        arrive = resolve;
                    })
            );
            const el = mount({ value: 'A'.repeat(1000), ...CUT });
            await flush();
            expect(fetchFullText).toHaveBeenCalledTimes(1);
            expect(fetchFullText).toHaveBeenCalledWith({
                configName: 'Test_Records',
                recordId: 'a01000000000001AAA',
                field: 'Notes__c'
            });
            expect(area(el).disabled).toBe(true);
            expect($(el, 'button[data-done]').disabled).toBe(true);
            expect($(el, '.rh-loading').textContent).toBe('Loading the whole text…');
            // Nothing can be committed while it loads, not even by Tab.
            const commit = listen(el, 'commit');
            const cancel = listen(el, 'cancel');
            expect(el.commit()).toBe(false);
            key(area(el), 'Tab');
            expect(commit).not.toHaveBeenCalled();
            expect(cancel).not.toHaveBeenCalled();

            arrive(WHOLE);
            await flush();
            expect(area(el).disabled).toBe(false);
            expect($(el, 'button[data-done]').disabled).toBe(false);
            expect($(el, '.rh-loading')).toBeNull();
            expect(area(el).value).toBe(WHOLE);
            expect($(el, '.rh-count').textContent).toBe(WHOLE.length.toLocaleString('en-US'));
            // Focus goes to the text area once it can be typed in.
            expect(el.shadowRoot.activeElement).toBe(area(el));
        });

        it('with the whole text read and nothing typed, commit leaves the cell as it was', async () => {
            fetchFullText.mockResolvedValue(WHOLE);
            const el = mount({ value: 'A'.repeat(1000), ...CUT });
            await flush();
            const commit = listen(el, 'commit');
            const cancel = listen(el, 'cancel');
            expect(el.commit()).toBe(true);
            expect(commit).not.toHaveBeenCalled();
            expect(cancel).toHaveBeenCalledTimes(1);
        });

        it('commits the whole text as edited', async () => {
            fetchFullText.mockResolvedValue(WHOLE);
            const el = mount({ value: 'A'.repeat(1000), ...CUT });
            await flush();
            const commit = listen(el, 'commit');
            type(el, WHOLE + '!');
            key(area(el), 'Enter', { ctrlKey: true });
            expect(committed(commit)).toEqual([WHOLE + '!']);
        });

        it('when the whole text cannot be read, says so and never commits', async () => {
            fetchFullText.mockRejectedValue({ body: { message: 'Insufficient access.' } });
            const el = mount({ value: 'A'.repeat(1000), ...CUT });
            await flush();
            expect($(el, '[role="alert"]').textContent).toBe(
                'The whole text could not be read, so it cannot be edited here. Insufficient access.'
            );
            expect($(el, '.rh-loading')).toBeNull();
            // Read-only, not disabled: it keeps focus, so Escape still leaves it.
            expect(area(el).readOnly).toBe(true);
            expect(area(el).disabled).toBe(false);
            const commit = listen(el, 'commit');
            const cancel = listen(el, 'cancel');
            // Even after typing, the shortened text is never saved: commit cancels.
            type(el, 'Something new');
            await flush();
            expect($(el, '[role="alert"]')).not.toBeNull();
            expect(el.commit()).toBe(true);
            key(area(el), 'Enter', { ctrlKey: true });
            $(el, 'button[data-done]').click();
            expect(commit).not.toHaveBeenCalled();
            expect(cancel).toHaveBeenCalledTimes(3);
        });

        it('reports an error with no server message too', async () => {
            fetchFullText.mockRejectedValue(new Error('Network down'));
            const el = mount({ value: 'A'.repeat(1000), ...CUT });
            await flush();
            expect($(el, '[role="alert"]').textContent).toBe(
                'The whole text could not be read, so it cannot be edited here. Network down'
            );
        });

        it('does not read anything for a value that was not shortened', async () => {
            const el = mount({ value: 'Short', ...CUT, cut: false });
            await flush();
            expect(fetchFullText).not.toHaveBeenCalled();
            expect(area(el).disabled).toBe(false);
        });
    });
});
