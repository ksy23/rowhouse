/**
 * Height. With no Height on the configuration the table fills the
 * window, from its own top edge to the bottom, less room for the Lightning
 * utility bar and, with unsaved changes, the Save bar. A Height in pixels wins.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

const ROWS = Array.from({ length: 30 }, (_, i) => ({ Id: 'a0' + String(i).padStart(16, '0'), Name: 'Row ' + (i + 1) }));
const TOP = 200; // where the scroller sits in the window
const RESERVE = 56; // utility bar and margin
const FOOTER = 92; // the Save bar's band (5.75rem)

describe('height', () => {
    let el;
    let innerHeight;
    const scroller = () => el.shadowRoot.querySelector('[data-scroller]');
    const maxHeight = () => scroller().style.maxHeight;

    let scrollerTop;

    beforeEach(() => {
        innerHeight = window.innerHeight;
        scrollerTop = TOP;
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
            const top = this.hasAttribute && this.hasAttribute('data-scroller') ? scrollerTop : 0;
            return { top, left: 0, width: 0, height: 0, right: 0, bottom: top, x: 0, y: top };
        });
    });
    afterEach(() => {
        while (document.body.firstChild) document.body.firstChild.remove();
        window.innerHeight = innerHeight;
        jest.restoreAllMocks();
    });

    async function mount(config) {
        el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: ROWS, ...config };
        document.body.appendChild(el);
        await flush();
        await frame();
        await flush();
    }

    it('fills the window from its top edge, leaving room for the utility bar', async () => {
        window.innerHeight = 900;
        await mount();
        expect(maxHeight()).toBe(`${900 - TOP - RESERVE}px`);
    });

    it('never shrinks below the minimum in a short window', async () => {
        window.innerHeight = 300;
        await mount();
        expect(maxHeight()).toBe('240px');
    });

    it('follows the window when it is resized', async () => {
        window.innerHeight = 900;
        await mount();
        window.innerHeight = 1100;
        window.dispatchEvent(new CustomEvent('resize'));
        await frame();
        await flush();
        expect(maxHeight()).toBe(`${1100 - TOP - RESERVE}px`);
    });

    it('measures after the whole update, when the parent has put something above it', async () => {
        window.innerHeight = 900;
        await mount();
        // A new config renders the table; then, in the same update, the parent
        // inserts a notice above it (LWC patches children last to first).
        el.config = { columns, rows: ROWS, totalRows: 50000, hasMore: true };
        await Promise.resolve();
        scrollerTop = TOP + 44;
        await frame();
        await flush();
        expect(maxHeight()).toBe(`${900 - TOP - 44 - RESERVE}px`);
    });

    it('makes room for the Save bar while there are unsaved changes', async () => {
        window.innerHeight = 900;
        await mount({ drafts: { [ROWS[0].Id]: { Name: 'Edited' } } });
        expect(maxHeight()).toBe(`${900 - TOP - RESERVE - FOOTER}px`);
    });

    it("uses the configuration's Height when there is one, never below 160 pixels", async () => {
        window.innerHeight = 900;
        await mount({ height: 320 });
        expect(maxHeight()).toBe('320px');
        el.config = { columns, rows: ROWS, height: 80 };
        await flush();
        expect(maxHeight()).toBe('160px');
    });
});
