/**
 * Moving focus without a redraw. A redraw of about 1,000 cells cost about 90ms
 * in Lightning for a change to two of them, so a plain
 * move changes the two cells in place (patchFocus): their tab stop and SLDS's
 * focus classes. Anything a move cannot do in place falls back to a redraw.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
// After mounting, the table measures its height and widths in the next frame
// and redraws once for them; counting starts after that.
const settled = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
const key = (target, k, opts = {}) =>
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...opts })
    );

// Count the table's redraws by the rows it builds: every render reads renderRows.
let draws = 0;
const descriptor = Object.getOwnPropertyDescriptor(GridTable.prototype, 'renderRows');
Object.defineProperty(GridTable.prototype, 'renderRows', {
    configurable: true,
    get() {
        draws++;
        return descriptor.get.call(this);
    }
});

describe('moving focus without a redraw', () => {
    let el;
    const cell = (id, field) => el.shadowRoot.querySelector(`td[data-row-id="${id}"][data-field="${field}"]`);
    const tabStops = () => [...el.shadowRoot.querySelectorAll('[role="grid"] [tabindex="0"]')];
    const mount = async (extra = {}) => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows.slice(0, 10), ...extra };
        document.body.appendChild(el);
        await flush();
        cell(seedRows[0].Id, 'Name').focus();
        await flush();
        await settled();
    };
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('moves the tab stop and the focus ring to the next cell, and redraws nothing', async () => {
        await mount();
        const from = cell(seedRows[0].Id, 'Name');
        draws = 0;
        key(from, 'ArrowRight');
        await flush();
        const to = cell(seedRows[0].Id, 'Pro_Number__c');
        expect(draws).toBe(0);
        expect(el.shadowRoot.activeElement).toBe(to);
        expect(to.getAttribute('tabindex')).toBe('0');
        expect(to.classList).toContain('slds-has-focus');
        expect(from.getAttribute('tabindex')).toBe('-1');
        expect(from.classList).not.toContain('slds-has-focus');
        expect(tabStops()).toEqual([to]);
    });

    it('moves down rows and into the header the same way', async () => {
        await mount();
        draws = 0;
        key(cell(seedRows[0].Id, 'Name'), 'ArrowDown');
        await flush();
        expect(el.shadowRoot.activeElement).toBe(cell(seedRows[1].Id, 'Name'));
        key(el.shadowRoot.activeElement, 'ArrowUp');
        await flush();
        key(el.shadowRoot.activeElement, 'ArrowUp');
        await flush();
        const th = el.shadowRoot.querySelector('th[data-field="Name"]');
        expect(el.shadowRoot.activeElement).toBe(th);
        expect(th.classList).toContain('slds-has-focus');
        expect(tabStops()).toEqual([th]);
        expect(draws).toBe(0);
    });

    it('keeps the moved focus when the table is next redrawn for another reason', async () => {
        await mount();
        key(cell(seedRows[0].Id, 'Name'), 'ArrowRight');
        await flush();
        key(el.shadowRoot.activeElement, 'ArrowDown');
        await flush();
        draws = 0;
        el.config = { ...el.config, rows: seedRows.slice(0, 9) };
        await flush();
        expect(draws).toBeGreaterThan(0);
        const to = cell(seedRows[1].Id, 'Pro_Number__c');
        expect(tabStops()).toEqual([to]);
        expect(to.classList).toContain('slds-has-focus');
        expect(el.shadowRoot.querySelectorAll('.slds-has-focus')).toHaveLength(1);
    });

    // LWC's redraw compares the new drawing with its last drawing, not with the
    // page: a cell moved in place since then, whose drawing did not change, kept
    // what the move gave it. A range after a plain move showed two focus rings
    // and two tab stops.
    const ringed = () => [...el.shadowRoot.querySelectorAll('.rh-cell_focus, .slds-has-focus')];

    it('takes the ring off a cell it moved to in place when a redraw moves focus on', async () => {
        await mount();
        key(cell(seedRows[0].Id, 'Name'), 'ArrowRight');
        await flush();
        key(el.shadowRoot.activeElement, 'ArrowDown', { shiftKey: true });
        await flush();
        const to = cell(seedRows[1].Id, 'Pro_Number__c');
        expect(el.shadowRoot.activeElement).toBe(to);
        expect(tabStops()).toEqual([to]);
        expect(ringed()).toEqual([to]);
    });

    it('gives the ring back to the cell last drawn with it when a redraw moves focus there', async () => {
        await mount();
        const home = cell(seedRows[0].Id, 'Name');
        key(home, 'ArrowRight');
        await flush();
        key(el.shadowRoot.activeElement, 'ArrowLeft', { shiftKey: true });
        await flush();
        expect(el.shadowRoot.activeElement).toBe(home);
        expect(tabStops()).toEqual([home]);
        expect(ringed()).toEqual([home]);
    });

    it('keeps one ring and one tab stop through moves, ranges and moves again', async () => {
        await mount();
        const moves = [
            ['ArrowRight'],
            ['ArrowDown'],
            ['ArrowDown', true],
            ['ArrowRight', true],
            ['ArrowLeft'],
            ['ArrowUp'],
            ['ArrowRight'],
            ['ArrowUp', true],
            ['ArrowDown'],
            ['ArrowLeft']
        ];
        // One after another: each move starts from where the last one left focus.
        await moves.reduce(
            (done, [k, shiftKey]) =>
                done.then(async () => {
                    key(el.shadowRoot.activeElement, k, { shiftKey: Boolean(shiftKey) });
                    await flush();
                    const active = el.shadowRoot.activeElement;
                    expect(tabStops()).toEqual([active]);
                    expect(ringed()).toEqual([active]);
                }),
            Promise.resolve()
        );
    });

    it('redraws for a cell with an error, whose message shows only while it has focus', async () => {
        const id = seedRows[0].Id;
        await mount({
            errors: { [id]: { row: null, fields: { Pro_Number__c: 'Data value too large: max length=20' } } }
        });
        draws = 0;
        key(cell(id, 'Name'), 'ArrowRight');
        await flush();
        expect(draws).toBeGreaterThan(0);
        expect(cell(id, 'Pro_Number__c').querySelector('.rh-error-popover')).not.toBeNull();
    });

    it('shades and unshades a range in place, without a redraw', async () => {
        await mount();
        const ids = seedRows.map(r => r.Id);
        draws = 0;
        key(cell(ids[0], 'Name'), 'ArrowDown', { shiftKey: true });
        await flush();
        expect(draws).toBe(0);
        const shaded = () =>
            [...el.shadowRoot.querySelectorAll('.rh-in-range')]
                .map(c => `${ids.indexOf(c.dataset.rowId)}:${c.dataset.field}`)
                .sort();
        expect(shaded()).toEqual(['0:Name', '1:Name']);
        expect(cell(ids[1], 'Name').getAttribute('aria-selected')).toBe('true');
        expect(cell(ids[1], 'Name').getAttribute('tabindex')).toBe('0'); // focus went with the range's corner
        key(el.shadowRoot.activeElement, 'ArrowRight', { shiftKey: true });
        await flush();
        expect(draws).toBe(0);
        expect(shaded()).toEqual(['0:Name', '0:Pro_Number__c', '1:Name', '1:Pro_Number__c']);
        expect(el.shadowRoot.querySelector('.rh-table-live').textContent).toBe('2 rows by 2 columns selected');
        // A plain move ends the range: its shading goes, still without a redraw.
        key(el.shadowRoot.activeElement, 'ArrowRight');
        await flush();
        expect(draws).toBe(0);
        expect(shaded()).toEqual([]);
        expect(cell(ids[1], 'Name').getAttribute('aria-selected')).toBeNull();
    });

    it('draws a range changed in place the same way when the table is redrawn after it', async () => {
        await mount();
        const ids = seedRows.map(r => r.Id);
        key(cell(ids[0], 'Name'), 'ArrowDown', { shiftKey: true });
        await flush();
        el.config = { ...el.config }; // any redraw
        await flush();
        expect([...el.shadowRoot.querySelectorAll('.rh-in-range')].map(c => c.dataset.rowId)).toEqual([ids[0], ids[1]]);
        expect(el.shadowRoot.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });

    it('redraws to bring a row outside the drawn window into view', async () => {
        const many = Array.from({ length: 400 }, (_, i) => ({
            Id: 'a0' + String(i).padStart(16, '0'),
            Name: 'Kennebec Lumber, load ' + (i + 1)
        }));
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: many };
        document.body.appendChild(el);
        await flush();
        el.shadowRoot.querySelector('td[data-field="Name"]').focus();
        await flush();
        await settled();
        draws = 0;
        key(el.shadowRoot.activeElement, 'End', { ctrlKey: true });
        await flush();
        expect(draws).toBeGreaterThan(0);
        expect(el.shadowRoot.activeElement.dataset.rowId).toBe(many[399].Id);
    });
});
