/**
 * The multi-select picklist editor (TC-040, TC-041).
 */
import { createElement } from 'lwc';
import CellMultiPicklist from 'c/cellMultiPicklist';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const OPTIONS = ['Fragile', 'Liftgate', 'Inside Delivery', 'Appointment', 'Hazmat'].map(v => ({ value: v, label: v }));

describe('cellMultiPicklist', () => {
    let el;
    let commits;
    const mount = async props => {
        el = createElement('c-cell-multi-picklist', { is: CellMultiPicklist });
        Object.assign(el, { options: OPTIONS, label: 'Handling', ...props });
        commits = [];
        el.addEventListener('commit', e => commits.push(e.detail));
        document.body.appendChild(el);
        await flush();
    };
    const box = () => el.shadowRoot.querySelector('lightning-dual-listbox');
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('TC-040: shows the stored values as a comma list', async () => {
        await mount({ value: 'Fragile;Liftgate;Inside Delivery' });
        expect(el.shadowRoot.textContent).toBe('Fragile, Liftgate, Inside Delivery');
    });

    it('TC-041: a single value has no trailing separator', async () => {
        await mount({ value: 'Liftgate' });
        expect(el.shadowRoot.textContent).toBe('Liftgate');
    });

    it('edits with the dual listbox, keeping an inactive stored value', async () => {
        await mount({ value: 'Fragile;Residential', mode: 'edit' });
        expect(box().value).toEqual(['Fragile', 'Residential']);
        expect(box().options.map(o => o.label)).toEqual([
            'Fragile',
            'Liftgate',
            'Inside Delivery',
            'Appointment',
            'Hazmat',
            'Residential (inactive)'
        ]);
    });

    it('TC-040: an unchanged value is committed exactly as stored', async () => {
        await mount({ value: 'Inside Delivery;Fragile', mode: 'edit' });
        el.shadowRoot.querySelector('[data-done]').click();
        expect(commits).toEqual([{ value: 'Inside Delivery;Fragile' }]);
    });

    it('commits the chosen values semicolon-delimited, and nothing chosen as blank', async () => {
        await mount({ value: 'Fragile', mode: 'edit' });
        box().dispatchEvent(new CustomEvent('change', { detail: { value: ['Fragile', 'Inside Delivery'] } }));
        el.commit();
        expect(commits).toEqual([{ value: 'Fragile;Inside Delivery' }]);
        box().dispatchEvent(new CustomEvent('change', { detail: { value: [] } }));
        el.commit();
        expect(commits[1]).toEqual({ value: null });
    });

    it('its box says what is chosen so far; the lists hang below it, left or right', async () => {
        await mount({ value: 'Fragile;Residential', mode: 'edit' });
        const summary = el.shadowRoot.querySelector('.rh-multi-summary');
        expect(summary.textContent).toBe('Fragile, Residential'); // as the cell will show it
        box().dispatchEvent(new CustomEvent('change', { detail: { value: ['Fragile', 'Inside Delivery'] } }));
        await flush();
        expect(summary.textContent).toBe('Fragile, Inside Delivery');
        const panel = el.shadowRoot.querySelector('.rh-multi-panel');
        expect(panel.contains(box())).toBe(true);
        expect(panel.classList).toContain('slds-dropdown_left');
        el.dropdownAlign = 'right';
        await flush();
        expect(panel.classList).toContain('slds-dropdown_right');
        el.dropdownUp = true;
        await flush();
        expect(panel.classList).toContain('slds-dropdown_bottom');
        // A click on the box leaves focus in the lists.
        const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
        summary.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
    });

    it('cancels on Escape and on Cancel', async () => {
        await mount({ value: 'Fragile', mode: 'edit' });
        const cancel = jest.fn();
        el.addEventListener('cancel', cancel);
        box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        el.shadowRoot.querySelector('.slds-button_neutral').click();
        expect(cancel).toHaveBeenCalledTimes(2);
        expect(commits).toEqual([]);
    });
});
