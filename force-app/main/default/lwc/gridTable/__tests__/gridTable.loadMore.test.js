/**
 * Loading more as you scroll. The table never fetches: it asks its
 * parent with a `loadmore` event when the user comes near the end of the
 * loaded rows, by scrolling, by keyboard, or with the Load more button.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
const key = (target, k, opts = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...opts }));

const big = n => Array.from({ length: n }, (_, i) => ({
    Id: 'a0' + String(i).padStart(16, '0'),
    Name: 'Row ' + (i + 1),
    Test_Case__c: 'MORE',
    Text_Field__c: 'text ' + (i + 1),
    Number_Field__c: i + 1
}));

describe('loading more as you scroll', () => {
    let el;
    let asked;
    const ROWS = big(300);
    const grid = () => el.shadowRoot.querySelector('[role="grid"]');
    const button = () => el.shadowRoot.querySelector('.rh-load-more-button');
    const cell = (rowIndex, colIndex = 1) =>
        el.shadowRoot.querySelector(`td[data-row-index="${rowIndex}"][data-col-index="${colIndex}"]`);

    async function mount(config) {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: ROWS, totalRows: 50000, hasMore: true, loadingMore: false, ...config };
        asked = 0;
        el.addEventListener('loadmore', () => { asked++; });
        document.body.appendChild(el);
        await flush();
    }
    afterEach(() => { while (document.body.firstChild) document.body.firstChild.remove(); });

    it('counts every row on the server for assistive technology, not just the loaded ones', async () => {
        await mount();
        expect(grid().getAttribute('aria-rowcount')).toBe('50001');
        expect(grid().getAttribute('aria-busy')).toBe('false');
    });

    it('offers a Load more button that says how many rows are not loaded', async () => {
        await mount();
        expect(button().textContent).toBe('Load more rows (49,700 not loaded)');
        button().click();
        expect(asked).toBe(1);
    });

    it('shows a spinner instead of the button while a page is on its way, and asks nothing more', async () => {
        await mount({ loadingMore: true });
        expect(button()).toBeNull();
        const spinner = el.shadowRoot.querySelector('.rh-load-more lightning-spinner');
        // Salesforce's own loading spinner: brand blue, medium (measured in Lightning Experience).
        expect(spinner.variant).toBe('brand');
        expect(spinner.size).toBe('medium');
        expect(spinner.alternativeText).toBe('Loading more rows');
        expect(grid().getAttribute('aria-busy')).toBe('true');
        const first = cell(1);
        first.focus();
        key(first, 'End', { ctrlKey: true });
        await flush();
        expect(asked).toBe(0);
    });

    it('asks when the keyboard jumps to the last loaded row (Ctrl+End)', async () => {
        await mount();
        const first = cell(1);
        first.focus();
        await flush();
        key(first, 'End', { ctrlKey: true });
        await flush();
        expect(asked).toBe(1);
    });

    it('asks when Arrow Down is pressed on the last loaded row', async () => {
        await mount({ rows: big(40) });
        const last = cell(40);
        last.focus();
        await flush();
        asked = 0;
        key(last, 'ArrowDown');
        await flush();
        expect(asked).toBe(1);
        expect(el.shadowRoot.activeElement).toBe(last);
    });

    it('does not ask while the keyboard is far from the end', async () => {
        await mount();
        const first = cell(1);
        first.focus();
        await flush();
        key(first, 'ArrowDown');
        await flush();
        expect(asked).toBe(0);
    });

    it('asks when scrolling comes near the end, not before', async () => {
        await mount();
        const scroller = el.shadowRoot.querySelector('[data-scroller]');
        scroller.scrollTop = 33 * 10;
        scroller.dispatchEvent(new CustomEvent('scroll'));
        await frame();
        expect(asked).toBe(0);
        scroller.scrollTop = 33 * 250;
        scroller.dispatchEvent(new CustomEvent('scroll'));
        await frame();
        expect(asked).toBe(1);
    });

    it('has no button and never asks when everything is loaded', async () => {
        await mount({ hasMore: false, totalRows: 300 });
        expect(el.shadowRoot.querySelector('.rh-load-more')).toBeNull();
        expect(grid().getAttribute('aria-rowcount')).toBe('301');
        const first = cell(1);
        first.focus();
        await flush();
        key(first, 'End', { ctrlKey: true });
        await flush();
        expect(asked).toBe(0);
    });

    it('in cards, Show more fetches the next page once every loaded card is showing', async () => {
        await mount({ rows: big(50), layout: 'cards' });
        const more = el.shadowRoot.querySelector('.rh-show-more');
        expect(more.textContent).toBe('Load more rows (49,950 not loaded)');
        more.click();
        expect(asked).toBe(1);
    });
});
