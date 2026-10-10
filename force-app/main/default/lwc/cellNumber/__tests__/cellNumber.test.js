/** Currency and the number editor — TC-022 and TC-026. */
import { createElement } from 'lwc';
import CellNumber from 'c/cellNumber';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const mount = props => {
    const el = createElement('rowhouse-cell', { is: CellNumber });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
};
afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('number cell', () => {
    it('TC-022 negative currency displays below zero, per locale', () => {
        const el = mount({ value: -1234.56, type: 'currency', scale: 2 });
        expect(el.shadowRoot.textContent).toMatch(/-\$1,234\.56|\(\$1,234\.56\)/);
    });
    it("in an org with more than one currency, shows the record's currency by its code and takes a plain number", async () => {
        const shown = mount({ value: 1000, type: 'currency', scale: 2, currencyCode: 'CAD' });
        expect(shown.shadowRoot.textContent).toBe('CAD 1,000.00');
        const edit = mount({
            value: 1000,
            mode: 'edit',
            label: 'Amount',
            type: 'currency',
            scale: 2,
            currencyCode: 'CAD'
        });
        await flush();
        // The input's currency format would show the user's currency instead.
        expect(edit.shadowRoot.querySelector('lightning-input').formatter).toBe('decimal');
        const plain = mount({ value: 1000, mode: 'edit', label: 'Amount', type: 'currency', scale: 2 });
        await flush();
        expect(plain.shadowRoot.querySelector('lightning-input').formatter).toBe('currency');
    });
    it('TC-026 accepts a grouped entry on commit', async () => {
        const el = mount({ value: 1, mode: 'edit', label: 'Amount', type: 'currency', scale: 2 });
        await flush();
        const input = el.shadowRoot.querySelector('lightning-input');
        input.dispatchEvent(new CustomEvent('change', { detail: { value: '1,234,567.89' } }));
        const handler = jest.fn();
        el.addEventListener('commit', handler);
        el.commit();
        expect(handler.mock.calls[0][0].detail.value).toBe(1234567.89);
    });
    it('TC-023 a typed value with extra decimals commits rounded to the field scale', async () => {
        const el = mount({ value: 1, mode: 'edit', label: 'Decimal', type: 'number', scale: 2 });
        await flush();
        el.shadowRoot
            .querySelector('lightning-input')
            .dispatchEvent(new CustomEvent('change', { detail: { value: '1234.567' } }));
        const handler = jest.fn();
        el.addEventListener('commit', handler);
        el.commit();
        expect(handler.mock.calls[0][0].detail.value).toBe(1234.57);
    });
    it('TC-023 an untouched stored value is committed unchanged, extra decimals and all', async () => {
        const el = mount({ value: '1234.567', mode: 'edit', label: 'Decimal', type: 'number', scale: 2 });
        await flush();
        const handler = jest.fn();
        el.addEventListener('commit', handler);
        el.commit(); // opened and closed without typing
        expect(handler.mock.calls[0][0].detail.value).toBe(1234.567);
    });
    it('TC-023 accepts extra decimals instead of flagging them, as the record form does', async () => {
        const el = mount({ value: 1, mode: 'edit', label: 'Decimal', type: 'number', scale: 2 });
        await flush();
        expect(el.shadowRoot.querySelector('lightning-input').step).toBe('any');
    });
    it('TC-024 an 18-digit entry commits as an exact string', async () => {
        const el = mount({ value: null, mode: 'edit', label: 'Number' });
        await flush();
        el.shadowRoot
            .querySelector('lightning-input')
            .dispatchEvent(new CustomEvent('change', { detail: { value: '999999999999999999' } }));
        const handler = jest.fn();
        el.addEventListener('commit', handler);
        el.commit();
        expect(handler.mock.calls[0][0].detail.value).toBe('999999999999999999');
    });
    it('an emptied input commits null, never an empty string', async () => {
        const el = mount({ value: 5, mode: 'edit', label: 'Number' });
        await flush();
        el.shadowRoot
            .querySelector('lightning-input')
            .dispatchEvent(new CustomEvent('change', { detail: { value: '' } }));
        const handler = jest.fn();
        el.addEventListener('commit', handler);
        el.commit();
        expect(handler.mock.calls[0][0].detail.value).toBeNull();
    });
});
