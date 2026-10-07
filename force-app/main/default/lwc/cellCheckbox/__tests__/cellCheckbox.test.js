/** TC-042 — a checkbox is never null. */
import { createElement } from 'lwc';
import CellCheckbox from 'c/cellCheckbox';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const mount = props => {
    const el = createElement('rowhouse-cell', { is: CellCheckbox });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
};
afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('checkbox cell', () => {
    it('TC-042 renders checked for true', () => {
        const el = mount({ value: true });
        expect(el.shadowRoot.querySelector('lightning-icon')).not.toBeNull();
    });
    it('null displays as unchecked and commits false, never null', async () => {
        const el = mount({ value: null, mode: 'edit', label: 'Active' });
        await flush();
        expect(el.shadowRoot.querySelector('input').checked).toBe(false);
        const handler = jest.fn();
        el.addEventListener('commit', handler);
        el.commit();
        expect(handler.mock.calls[0][0].detail.value).toBe(false);
    });
    it('ticking the box is the edit: it commits the new state at once', async () => {
        const el = mount({ value: false, mode: 'edit', label: 'Active' });
        await flush();
        const handler = jest.fn();
        el.addEventListener('commit', handler);
        const input = el.shadowRoot.querySelector('input');
        input.checked = true;
        input.dispatchEvent(new CustomEvent('change'));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail.value).toBe(true);
    });

    it('clearing the box commits false at once', async () => {
        const el = mount({ value: true, mode: 'edit', label: 'Active' });
        await flush();
        const handler = jest.fn();
        el.addEventListener('commit', handler);
        const input = el.shadowRoot.querySelector('input');
        input.checked = false;
        input.dispatchEvent(new CustomEvent('change'));
        expect(handler.mock.calls[0][0].detail.value).toBe(false);
    });

    it('a mousedown on the box keeps focus on the input, so the editor does not close before the click', async () => {
        const el = mount({ value: false, mode: 'edit', label: 'Active' });
        await flush();
        const input = el.shadowRoot.querySelector('input');
        const focus = jest.spyOn(input, 'focus');
        const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
        el.shadowRoot.querySelector('.slds-checkbox_faux').dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        expect(focus).toHaveBeenCalled();
    });
});
