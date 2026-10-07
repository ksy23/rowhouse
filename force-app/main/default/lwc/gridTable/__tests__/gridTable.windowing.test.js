/**
 * Row windowing. content-visibility does nothing on a real table, so large views are windowed in JavaScript and HR-10 is mandatory:
 * every rendered row carries a correct aria-rowindex against the full count.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const key = (target, k, opts = {}) =>
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...opts })
    );

const big = n =>
    Array.from({ length: n }, (_, i) => ({
        Id: 'a0' + String(i).padStart(16, '0'),
        Name: 'Row ' + (i + 1),
        Test_Case__c: 'BENCH',
        Text_Field__c: 'text ' + (i + 1),
        Number_Field__c: i + 1
    }));

describe('windowing', () => {
    let el;
    const rows = () => [...el.shadowRoot.querySelectorAll('tr[role="row"][data-row-id]')];
    beforeEach(async () => {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: big(1000) };
        document.body.appendChild(el);
        await flush();
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
    });

    it('describes the errors of rendered rows only, in row order', async () => {
        // It reads the errors and the window directly.
        const rowsNow = big(1000);
        const idOf = i => rowsNow[i].Id;
        el.config = {
            columns,
            rows: rowsNow,
            errors: {
                [idOf(5)]: { row: null, fields: { Name: 'Second' } },
                [idOf(900)]: { row: null, fields: { Name: 'Not rendered' } },
                [idOf(2)]: { row: null, fields: { Name: 'First', Number_Field__c: 'Also first' } }
            }
        };
        await flush();
        const texts = [...el.shadowRoot.querySelectorAll('.slds-assistive-text span[id]')].map(s => s.textContent);
        expect(texts).toEqual(['Error: First', 'Error: Also first', 'Error: Second']);
        const td = el.shadowRoot.querySelector(`td[data-row-id="${idOf(2)}"][data-field="Name"]`);
        expect(el.shadowRoot.querySelector(`[id="${td.getAttribute('aria-describedby')}"]`).textContent).toBe(
            'Error: First'
        );
    });

    it('renders a window, not every row', () => {
        expect(rows().length).toBeGreaterThan(0);
        expect(rows().length).toBeLessThan(200);
    });

    it('reports the full count and a correct index on every rendered row (HR-10)', () => {
        const grid = el.shadowRoot.querySelector('[role="grid"]');
        expect(grid.getAttribute('aria-rowcount')).toBe('1001');
        rows().forEach(r => {
            const i = Number(r.getAttribute('aria-rowindex'));
            expect(r.dataset.rowId).toBe('a0' + String(i - 2).padStart(16, '0'));
        });
        // The spacer rows are hidden from assistive technology entirely.
        el.shadowRoot.querySelectorAll('.rh-spacer').forEach(s => {
            expect(s.getAttribute('aria-hidden')).toBe('true');
            expect(s.getAttribute('role')).toBe('none');
        });
    });

    it('Ctrl+End reaches the last row of the DATA, not the last rendered row', async () => {
        const first = el.shadowRoot.querySelector('td[data-row-index="1"][data-col-index="1"]');
        first.focus();
        await flush();
        key(first, 'End', { ctrlKey: true });
        await flush();
        await flush();
        const active = el.shadowRoot.activeElement;
        expect(active).not.toBeNull();
        expect(active.dataset.rowIndex).toBe('1000');
        expect(active.dataset.colIndex).toBe(String(columns.length));
    });

    it('Ctrl+Home comes back to the header row', async () => {
        const first = el.shadowRoot.querySelector('td[data-row-index="1"][data-col-index="1"]');
        first.focus();
        await flush();
        key(first, 'End', { ctrlKey: true });
        await flush();
        await flush();
        key(el.shadowRoot.activeElement, 'Home', { ctrlKey: true });
        await flush();
        await flush();
        expect(el.shadowRoot.activeElement.dataset.rowIndex).toBe('0');
        expect(el.shadowRoot.activeElement.dataset.colIndex).toBe('1');
    });
});

describe('row height measurement', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        delete HTMLTableRowElement.prototype.offsetHeight;
    });

    it('measures a row that has a top border, not the first one (found in Lightning Experience)', async () => {
        // SLDS draws no top border on the body's first row: 76px, then 77px for
        // every other row. Measuring the first row would put the spacers out by
        // a pixel per row.
        Object.defineProperty(HTMLTableRowElement.prototype, 'offsetHeight', {
            configurable: true,
            get() {
                if (!this.dataset.rowId) return 0;
                const prev = this.previousElementSibling;
                return prev && prev.dataset.rowId ? 77 : 76;
            }
        });
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: big(1000) };
        document.body.appendChild(el);
        await flush();
        await new Promise(resolve => requestAnimationFrame(resolve));
        await flush();
        const rendered = el.shadowRoot.querySelectorAll('tr[role="row"][data-row-id]').length;
        const bottom = el.shadowRoot.querySelectorAll('tr.rh-spacer td');
        const last = bottom[bottom.length - 1];
        expect(last.getAttribute('style')).toBe(`height:${(1000 - rendered) * 77}px`);
    });
});

describe('windowing a grid that fills a tall window', () => {
    let innerHeight;
    beforeEach(() => {
        innerHeight = window.innerHeight;
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
            const top = this.hasAttribute && this.hasAttribute('data-scroller') ? 200 : 0;
            return { top, left: 0, width: 0, height: 0, right: 0, bottom: top, x: 0, y: top };
        });
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        window.innerHeight = innerHeight;
        jest.restoreAllMocks();
    });

    it('draws enough rows for the new height as soon as it fills the window', async () => {
        // Found in Lightning Experience: the redraw after filling
        // the window still windowed the rows for the first render's 480px box.
        window.innerHeight = 3000;
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: big(1000) };
        document.body.appendChild(el);
        await flush();
        await new Promise(resolve => requestAnimationFrame(resolve));
        await flush();
        const box = parseInt(el.shadowRoot.querySelector('[data-scroller]').style.maxHeight, 10);
        expect(box).toBe(3000 - 200 - 56);
        const rendered = el.shadowRoot.querySelectorAll('tr[role="row"][data-row-id]').length;
        // Every row the box can show (33px each until measured), and the buffer below.
        expect(rendered).toBeGreaterThanOrEqual(Math.ceil(box / 33) + 20);
    });
});
