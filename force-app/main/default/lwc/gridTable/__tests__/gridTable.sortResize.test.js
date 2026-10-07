/**
 * Multi-column sort ordering and keyboard column resize.
 * The ARIA side of sorting is in gridTable.aria.test.js; this asserts ORDER.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const tc = n => seedRows.find(r => r.Test_Case__c.startsWith(n));

describe('sorting', () => {
    let el;
    const order = () => [...el.shadowRoot.querySelectorAll('tr[role="row"][data-row-id]')].map(r => r.dataset.rowId);
    const sortBy = async (field, shiftKey = false) => {
        el.shadowRoot
            .querySelector(`th[data-field="${field}"] .slds-th__action`)
            .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey }));
        await flush();
    };
    beforeEach(async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows };
        document.body.appendChild(el);
        await flush();
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('TC-049..054: nulls last, case-insensitive, accents after base, text "10" before "9"', async () => {
        await sortBy('Text_Field__c');
        const ids = order();
        const pos = n => ids.indexOf(tc(n).Id);
        expect(pos('TC-053')).toBeLessThan(pos('TC-054')); // "10" before "9" as text
        expect(pos('TC-050')).toBeLessThan(pos('TC-052')); // apple before Äpple
        expect(pos('TC-051')).toBeLessThan(pos('TC-052')); // Apple before Äpple
        expect(pos('TC-049')).toBeGreaterThan(pos('TC-052')); // null after every value
        // Every row with a null Text_Field__c comes after every row with a value.
        const firstNull = ids.findIndex(id => seedRows.find(r => r.Id === id).Text_Field__c == null);
        ids.slice(firstNull).forEach(id => expect(seedRows.find(r => r.Id === id).Text_Field__c == null).toBe(true));
    });

    it('sorts the Number column numerically: 9 before 10, negatives below zero (TC-022)', async () => {
        await sortBy('Number_Field__c');
        const ids = order();
        const pos = n => ids.indexOf(tc(n).Id);
        expect(pos('TC-054')).toBeLessThan(pos('TC-053'));
        expect(pos('TC-022')).toBeLessThan(pos('TC-003'));
    });

    it('a second click flips the direction; nulls stay last', async () => {
        await sortBy('Number_Field__c');
        await sortBy('Number_Field__c');
        const header = el.shadowRoot.querySelector('th[data-field="Number_Field__c"]');
        expect(header.getAttribute('aria-sort')).toBe('descending');
        const ids = order();
        expect(seedRows.find(r => r.Id === ids[ids.length - 1]).Number_Field__c).toBeNull();
    });

    it('shift+click adds a secondary key that orders ties in the primary', async () => {
        await sortBy('Text_Field__c');
        await sortBy('Number_Field__c', true);
        // TC-047 and TC-048 tie on both keys; the Id tiebreak keeps them stable.
        const ids = order();
        expect(ids.indexOf(tc('TC-047').Id)).toBeLessThan(ids.indexOf(tc('TC-048').Id));
        const directed = [...el.shadowRoot.querySelectorAll('th[aria-sort="ascending"], th[aria-sort="descending"]')];
        expect(directed).toHaveLength(1); // HR-14: ARIA carries the primary key only
    });
});

describe('sort indicator', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('always uses the down arrow and lets the SLDS direction class rotate it', async () => {
        // Regression, found in Lightning Experience: swapping in arrowup for
        // descending cancelled SLDS's own rotation, so both directions showed "up".
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows };
        document.body.appendChild(el);
        await flush();
        const th = () => el.shadowRoot.querySelector('th[data-field="Number_Field__c"]');
        const click = async () => {
            th()
                .querySelector('.slds-th__action')
                .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await flush();
        };
        await click();
        expect(th().classList).toContain('slds-is-sorted_asc');
        expect(th().querySelector('.slds-is-sortable__icon').iconName).toBe('utility:arrowdown');
        await click();
        expect(th().classList).toContain('slds-is-sorted_desc');
        expect(th().querySelector('.slds-is-sortable__icon').iconName).toBe('utility:arrowdown');
    });
});

describe('keyboard column resize', () => {
    it('the visually-hidden range input sets the column width', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows.slice(0, 3) };
        document.body.appendChild(el);
        await flush();
        const range = el.shadowRoot.querySelector('th[data-field="Text_Field__c"] input[type="range"]');
        expect(range.getAttribute('aria-label')).toBe('Text column width');
        expect(range.getAttribute('min')).toBe('20');
        expect(range.getAttribute('max')).toBe('1000');
        range.value = '240';
        range.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(el.shadowRoot.querySelector('th[data-field="Text_Field__c"]').style.width).toBe('240px');
        el.remove();
    });
});

describe('column widths after a resize', () => {
    // JSDOM has no layout, so each header cell reports a rendered width here:
    // 200.6px, as if the grid had shared its space out among the columns.
    // Pinned widths round down, so no pixel of scrollbar appears.
    let spy;
    beforeEach(() => {
        spy = jest
            .spyOn(HTMLTableCellElement.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 200.6, height: 33, top: 0, left: 0, right: 200.6, bottom: 33, x: 0, y: 0 });
    });
    afterEach(() => {
        spy.mockRestore();
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    const mount = async (extra = {}) => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows.slice(0, 3), ...extra };
        document.body.appendChild(el);
        await flush();
        return el;
    };
    const th = (el, field) => el.shadowRoot.querySelector(`th[data-field="${field}"]`);

    it('fills the grid until the first resize', async () => {
        const el = await mount();
        expect(el.shadowRoot.querySelector('table').style.width).toBe('');
    });

    it('pins every column at its rendered width, so the resized one keeps exactly its new width', async () => {
        // Regression, found in Lightning Experience: a fixed-layout table at 100%
        // stretched a column dragged to 406px out to 500px.
        const el = await mount();
        const range = th(el, 'Text_Field__c').querySelector('input[type="range"]');
        range.dispatchEvent(new CustomEvent('focus'));
        await flush();
        expect(range.value).toBe('200'); // the real width, not the 150 default
        range.value = '260';
        range.dispatchEvent(new CustomEvent('input'));
        await flush();

        const cells = [...el.shadowRoot.querySelectorAll('thead th[data-field]')];
        cells.forEach(cell => {
            const expected = cell.dataset.field === 'Text_Field__c' ? '260px' : '200px';
            expect(cell.style.width).toBe(expected);
        });
        // The table is exactly its columns: 60px wider than before, not stretched.
        const total = (cells.length - 1) * 200 + 260;
        expect(el.shadowRoot.querySelector('table').style.width).toBe(total + 'px');
    });

    it('a pointer drag pins first and then follows the pointer', async () => {
        const el = await mount();
        const handle = th(el, 'Number_Field__c').querySelector('.slds-resizable__handle');
        handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 500 }));
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }));
        window.dispatchEvent(new MouseEvent('pointerup', {}));
        await flush();
        expect(th(el, 'Number_Field__c').style.width).toBe('100px');
        expect(th(el, 'Text_Field__c').style.width).toBe('200px');
        const count = el.shadowRoot.querySelectorAll('thead th[data-field]').length;
        expect(el.shadowRoot.querySelector('table').style.width).toBe((count - 1) * 200 + 100 + 'px');
    });

    describe('before a resize, room over goes to the data columns only', () => {
        // Found in Lightning Experience: in a child table of two
        // columns, the fixed-layout table stretched the checkbox column from
        // 52px to 248px along with the rest.
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        const TWO = [
            { field: 'Name', label: 'Name', type: 'text', width: 220 },
            { field: 'Amount__c', label: 'Amount', type: 'currency', width: 140 }
        ];
        let widthSpy;
        beforeEach(() => {
            // The scroller is 1,000px wide; JSDOM has no layout of its own.
            widthSpy = jest.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function width() {
                return this.hasAttribute('data-scroller') ? 1000 : 0;
            });
        });
        afterEach(() => widthSpy.mockRestore());

        const mountTwo = async columnsOf => {
            const el = createElement('rowhouse-grid-table', { is: GridTable });
            el.config = { columns: columnsOf, rows: seedRows.slice(0, 2), selection: 'multi' };
            document.body.appendChild(el);
            await flush();
            await frame(); // the width is measured after the render (HR-20)
            await flush();
            return el;
        };

        it('keeps the checkbox column at 52px and shares the rest in proportion', async () => {
            const el = await mountTwo(TWO);
            expect(th(el, '__select').style.width).toBe('52px');
            // 1,000px less the checkbox column and the table's 2px of border:
            // 946px of room, shared 220 : 140, rounded down.
            expect(th(el, 'Name').style.width).toBe('578px');
            expect(th(el, 'Amount__c').style.width).toBe('367px');
            expect(el.shadowRoot.querySelector('table').style.width).toBe(''); // still not pinned
        });

        it("leaves room for the table's borders, so it never scrolls sideways by 2px", async () => {
            // Found in Lightning Experience: a two-row grid scrolled
            // sideways because the columns filled the box and the borders did not fit.
            const el = await mountTwo(TWO);
            const widths = [...el.shadowRoot.querySelectorAll('thead th[data-field]')].reduce(
                (sum, cell) => sum + parseInt(cell.style.width, 10),
                0
            );
            expect(widths + 2).toBeLessThanOrEqual(1000);
        });

        it('gives a column with no width its own (a figure: its fitted width) and still shares the room', async () => {
            const el = await mountTwo([TWO[0], { ...TWO[1], width: undefined }]);
            const name = parseInt(th(el, 'Name').style.width, 10);
            const amount = parseInt(th(el, 'Amount__c').style.width, 10);
            expect(amount).toBeGreaterThanOrEqual(130); // a currency column is never narrower (gridSizing)
            expect(name).toBeGreaterThan(220);
            expect(name + amount).toBeGreaterThanOrEqual(944); // 946px of room, each share rounded down
            expect(name + amount).toBeLessThanOrEqual(946);
        });
    });

    describe('the resize guide lines', () => {
        // Found in Lightning Experience: SLDS draws each column's
        // guide line 100vh tall, so a two-row grid scrolled into empty space.
        let heightSpy;
        beforeEach(() => {
            heightSpy = jest.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function height() {
                return this.hasAttribute('data-scroller') ? 145 : 0;
            });
        });
        afterEach(() => heightSpy.mockRestore());

        it('reach the bottom of what the grid shows, and no further', async () => {
            const el = createElement('rowhouse-grid-table', { is: GridTable });
            el.config = {
                columns: [{ field: 'Name', label: 'Name', type: 'text', width: 220 }],
                rows: seedRows.slice(0, 2)
            };
            document.body.appendChild(el);
            await flush();
            const thead = el.shadowRoot.querySelector('thead');
            expect(thead.style.getPropertyValue('--rh-divider-height')).toBe('145px');
            expect(el.shadowRoot.querySelector('.slds-resizable__divider').classList).toContain('rh-resize-divider');
        });

        it("start below the table's top border, and end at the bottom of the box, not 1px past it", async () => {
            // Found in Lightning Experience: the header cells sit 1px
            // below the box's top, so a line as tall as the box overflowed by 1px.
            const rectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
                let top = 0;
                if (this.hasAttribute('data-scroller')) top = 100;
                else if (this.classList.contains('rh-resize-divider')) top = 101;
                return { top, left: 0, right: 0, bottom: top, width: 0, height: 0 };
            });
            try {
                const el = createElement('rowhouse-grid-table', { is: GridTable });
                el.config = {
                    columns: [{ field: 'Name', label: 'Name', type: 'text', width: 220 }],
                    rows: seedRows.slice(0, 2)
                };
                document.body.appendChild(el);
                await flush();
                expect(el.shadowRoot.querySelector('thead').style.getPropertyValue('--rh-divider-height')).toBe(
                    '144px'
                );
            } finally {
                rectSpy.mockRestore();
            }
        });

        it('stop short of a box whose height is a fraction of a pixel', async () => {
            // Found in Lightning Experience: the box was 144.5px,
            // clientHeight said 145, and half a pixel over still showed a scrollbar.
            const rectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
                if (this.hasAttribute('data-scroller'))
                    return { top: 100, left: 0, right: 0, bottom: 244.5, width: 0, height: 144.5 };
                const top = this.classList.contains('rh-resize-divider') ? 101 : 0;
                return { top, left: 0, right: 0, bottom: top, width: 0, height: 0 };
            });
            const offsetSpy = jest
                .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
                .mockImplementation(function height() {
                    return this.hasAttribute('data-scroller') ? 145 : 0;
                });
            try {
                const el = createElement('rowhouse-grid-table', { is: GridTable });
                el.config = {
                    columns: [{ field: 'Name', label: 'Name', type: 'text', width: 220 }],
                    rows: seedRows.slice(0, 2)
                };
                document.body.appendChild(el);
                await flush();
                expect(el.shadowRoot.querySelector('thead').style.getPropertyValue('--rh-divider-height')).toBe(
                    '143px'
                );
            } finally {
                rectSpy.mockRestore();
                offsetSpy.mockRestore();
            }
        });

        it('follow the grid when its height changes', async () => {
            const el = createElement('rowhouse-grid-table', { is: GridTable });
            el.config = {
                columns: [{ field: 'Name', label: 'Name', type: 'text', width: 220 }],
                rows: seedRows.slice(0, 2)
            };
            document.body.appendChild(el);
            await flush();
            heightSpy.mockImplementation(function height() {
                return this.hasAttribute('data-scroller') ? 300 : 0;
            });
            el.config = { ...el.config, rows: seedRows.slice(0, 5) };
            await flush();
            expect(el.shadowRoot.querySelector('thead').style.getPropertyValue('--rh-divider-height')).toBe('300px');
        });
    });

    it('counts the selection column at its fixed width', async () => {
        const el = await mount({ selection: 'multi' });
        expect(th(el, '__select').style.width).toBe('52px');
        const range = th(el, 'Text_Field__c').querySelector('input[type="range"]');
        range.value = '300';
        range.dispatchEvent(new CustomEvent('input'));
        await flush();
        const dataCells = el.shadowRoot.querySelectorAll('thead th[data-field]').length - 1;
        expect(el.shadowRoot.querySelector('table').style.width).toBe(52 + (dataCells - 1) * 200 + 300 + 'px');
    });
});
