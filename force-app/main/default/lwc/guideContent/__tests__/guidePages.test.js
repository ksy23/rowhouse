/**
 * The Grid Guide's pages (D-53): every page renders, every link between pages
 * leads to a page and a section that exist, links move within the tab,
 * section links scroll, a page opens at the section it is asked for, and
 * copy buttons copy.
 */
import { createElement } from 'lwc';
import GuideContent from 'c/guideContent';
import { PAGES } from 'c/guideCatalog';

const mockNavigate = jest.fn();
jest.mock('lightning/navigation', () => {
    const Navigate = Symbol('Navigate');
    const GenerateUrl = Symbol('GenerateUrl');
    const NavigationMixin = Base =>
        class extends Base {
            [Navigate](ref) {
                mockNavigate(ref);
            }
            [GenerateUrl]() {
                return Promise.resolve('');
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: jest.fn() };
});

const settle = async () => {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

let el;
const show = async (page, section) => {
    el = createElement('c-guide-content', { is: GuideContent });
    el.page = page;
    if (section) el.section = section;
    document.body.appendChild(el);
    await settle();
    return el;
};
/** The page component inside guideContent, and its shadow root. */
const pageRoot = () => el.shadowRoot.firstElementChild.shadowRoot;

let scrolled;
beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = jest.fn(function scroll() {
        scrolled.push(this);
    });
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

describe('every page', () => {
    // Each page is rendered once, and what the tests need is kept.
    const seen = {};
    const collect = id => {
        const root = pageRoot();
        return {
            root: Boolean(root.querySelector('.rh-page')),
            h1: (root.querySelector('h1') || { textContent: '' }).textContent.trim(),
            anchors: new Set([...root.querySelectorAll('[data-anchor]')].map(a => a.getAttribute('data-anchor'))),
            links: [...root.querySelectorAll('a[data-page]')]
                .map(a => ({ page: a.getAttribute('data-page'), section: a.getAttribute('data-section') }))
                .concat([...root.querySelectorAll('a[data-anchor-link]')].map(a => ({ page: id, section: a.getAttribute('data-anchor-link') })))
        };
    };
    beforeAll(async () => {
        for (const p of PAGES) {
            // eslint-disable-next-line no-await-in-loop
            await show(p.id);
            seen[p.id] = collect(p.id);
            document.body.removeChild(el);
        }
    });

    it.each(PAGES.map(p => [p.id]))('%s renders, with a heading', id => {
        expect(seen[id].root).toBe(true);
        expect(seen[id].h1).not.toBe('');
    });

    it('links only to pages of the guide, and to sections those pages have', () => {
        const links = Object.values(seen).flatMap(s => s.links);
        expect(links.length).toBeGreaterThan(100);
        const broken = links.filter(l => !seen[l.page] || (l.section && !seen[l.page].anchors.has(l.section)));
        expect(broken).toEqual([]);
    });
});

describe('links between pages', () => {
    it('move within the Grid Guide tab', async () => {
        await show('start');
        const link = pageRoot().querySelector('a[data-page="configure"]');
        expect(link.getAttribute('href')).toMatch(/^\/lightning\/n\/Rowhouse_Guide\?c__page=configure/);
        link.click();
        expect(mockNavigate).toHaveBeenCalledWith({ type: 'standard__navItemPage', attributes: { apiName: 'Rowhouse_Guide' }, state: { c__page: 'configure' } });
    });

    it('open at a section when the link names one', async () => {
        await show('welcome');
        const link = pageRoot().querySelector('a[data-page="using"][data-section="keys"]');
        link.click();
        expect(mockNavigate).toHaveBeenCalledWith({ type: 'standard__navItemPage', attributes: { apiName: 'Rowhouse_Guide' }, state: { c__page: 'using', c__section: 'keys' } });
    });

    it('are left to the browser with Ctrl or Cmd, to open in a new tab', async () => {
        await show('start');
        const link = pageRoot().querySelector('a[data-page="configure"]');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
        link.dispatchEvent(event);
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});

describe('sections', () => {
    it('a link to a section of the same page scrolls there', async () => {
        await show('start');
        const link = pageRoot().querySelector('a[data-anchor-link="access"]');
        link.click();
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(scrolled.map(s => s.getAttribute('data-anchor'))).toContain('access');
    });

    it('a page asked for at a section opens there', async () => {
        await show('configure', 'filter');
        expect(scrolled.map(s => s.getAttribute('data-anchor'))).toEqual(['filter']);
    });

    it('a new section on the same page scrolls again', async () => {
        await show('configure', 'filter');
        el.section = 'action';
        await settle();
        expect(scrolled.map(s => s.getAttribute('data-anchor'))).toEqual(['filter', 'action']);
    });
});

describe('copy buttons', () => {
    it('copy their value and say so', async () => {
        const writeText = jest.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await show('start');
        const toasts = [];
        el.shadowRoot.firstElementChild.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
        const button = pageRoot().querySelector('button[data-copy]');
        button.click();
        await settle();
        expect(writeText).toHaveBeenCalledWith(button.getAttribute('data-copy'));
        expect(toasts).toEqual([expect.objectContaining({ title: 'Copied', variant: 'success' })]);
        delete navigator.clipboard;
    });
});

describe('the sample file', () => {
    it('downloads from its static resource', async () => {
        await show('tutorial-cleanup');
        const link = pageRoot().querySelector('a[download="event-attendees.csv"]');
        expect(link).not.toBeNull();
        expect(link.getAttribute('href')).toContain('RowhouseSampleAttendees');
    });
});
