/**
 * The multi-select picklist editor (TC-040, TC-041).
 */
import { createElement } from 'lwc';
import CellMultiPicklist from 'c/cellMultiPicklist';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const OPTIONS = ['Red', 'Green', 'Blue', 'Amber', 'Slate'].map(v => ({ value: v, label: v }));

describe('cellMultiPicklist', () => {
    let el;
    let commits;
    const mount = async props => {
        el = createElement('c-cell-multi-picklist', { is: CellMultiPicklist });
        Object.assign(el, { options: OPTIONS, label: 'Colors', ...props });
        commits = [];
        el.addEventListener('commit', e => commits.push(e.detail));
        document.body.appendChild(el);
        await flush();
    };
    const box = () => el.shadowRoot.querySelector('lightning-dual-listbox');
    afterEach(() => { while (document.body.firstChild) document.body.firstChild.remove(); });

    it('TC-040: shows the stored values as a comma list', async () => {
        await mount({ value: 'Red;Green;Blue' });
        expect(el.shadowRoot.textContent).toBe('Red, Green, Blue');
    });

    it('TC-041: a single value has no trailing separator', async () => {
        await mount({ value: 'Green' });
        expect(el.shadowRoot.textContent).toBe('Green');
    });

    it('edits with the dual listbox, keeping an inactive stored value', async () => {
        await mount({ value: 'Red;Retired', mode: 'edit' });
        expect(box().value).toEqual(['Red', 'Retired']);
        expect(box().options.map(o => o.label)).toEqual(['Red', 'Green', 'Blue', 'Amber', 'Slate', 'Retired (inactive)']);
    });

    it('TC-040: an unchanged value is committed exactly as stored', async () => {
        await mount({ value: 'Blue;Red', mode: 'edit' });
        el.shadowRoot.querySelector('[data-done]').click();
        expect(commits).toEqual([{ value: 'Blue;Red' }]);
    });

    it('commits the chosen values semicolon-delimited, and nothing chosen as blank', async () => {
        await mount({ value: 'Red', mode: 'edit' });
        box().dispatchEvent(new CustomEvent('change', { detail: { value: ['Red', 'Blue'] } }));
        el.commit();
        expect(commits).toEqual([{ value: 'Red;Blue' }]);
        box().dispatchEvent(new CustomEvent('change', { detail: { value: [] } }));
        el.commit();
        expect(commits[1]).toEqual({ value: null });
    });

    it('its box says what is chosen so far; the lists hang below it, left or right', async () => {
        await mount({ value: 'Red;Retired', mode: 'edit' });
        const summary = el.shadowRoot.querySelector('.rh-multi-summary');
        expect(summary.textContent).toBe('Red, Retired'); // as the cell will show it
        box().dispatchEvent(new CustomEvent('change', { detail: { value: ['Red', 'Blue'] } }));
        await flush();
        expect(summary.textContent).toBe('Red, Blue');
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
        await mount({ value: 'Red', mode: 'edit' });
        const cancel = jest.fn();
        el.addEventListener('cancel', cancel);
        box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        el.shadowRoot.querySelector('.slds-button_neutral').click();
        expect(cancel).toHaveBeenCalledTimes(2);
        expect(commits).toEqual([]);
    });
});
