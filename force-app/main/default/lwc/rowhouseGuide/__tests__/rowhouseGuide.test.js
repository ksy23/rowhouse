/**
 * The Grid Guide tab: the page the address asks for, the sections a
 * reader may read, and the admin pages kept for grid admins.
 */
import { createElement } from 'lwc';
import RowhouseGuide from 'c/rowhouseGuide';
import { CurrentPageReference } from 'lightning/navigation';

jest.mock('@salesforce/customPermission/Rowhouse_Admin', () => ({ default: true }), { virtual: true });

const mockNavigate = jest.fn();
jest.mock('lightning/navigation', () => {
    // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
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
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const settle = async () => {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

let el;
const open = async state => {
    el = createElement('c-rowhouse-guide', { is: RowhouseGuide });
    document.body.appendChild(el);
    // eslint-disable-next-line @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit
    CurrentPageReference.emit({
        type: 'standard__navItemPage',
        attributes: { apiName: 'Rowhouse_Guide' },
        state: state || {}
    });
    await settle();
};
const $ = s => el.shadowRoot.querySelector(s);
const $$ = s => [...el.shadowRoot.querySelectorAll(s)];
const navLabels = () => $$('.rh-guide-nav-link').map(a => a.textContent);

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

describe('the page', () => {
    it('opens on Welcome', async () => {
        await open();
        const content = $('c-guide-content');
        expect(content.page).toBe('welcome');
        expect(content.section).toBe('');
        expect($('.rh-guide-nav-item_current a').textContent).toBe('Welcome');
    });

    it('opens the page and section the address names', async () => {
        await open({ c__page: 'configure', c__section: 'filter' });
        const content = $('c-guide-content');
        expect(content.page).toBe('configure');
        expect(content.section).toBe('filter');
        expect($('.rh-guide-nav-item_current a').getAttribute('aria-current')).toBe('page');
        expect($('.rh-guide-nav-item_current a').textContent).toBe('Configure');
    });

    it('marks Tutorials while a tutorial is open', async () => {
        await open({ c__page: 'tutorial-pipeline' });
        expect($('.rh-guide-nav-item_current a').textContent).toBe('Tutorials');
    });

    it('says whose it is in the footer', async () => {
        await open();
        expect($('.rh-guide-footer').textContent.trim()).toMatch(/^Rowhouse by Kugamon is free and open source/);
    });

    it('opens Welcome for a page the guide does not have', async () => {
        await open({ c__page: 'nonsense' });
        expect($('c-guide-content').page).toBe('welcome');
    });
});

describe('who reads what', () => {
    it('shows a grid admin every section', async () => {
        await open();
        expect(navLabels()).toEqual([
            'Welcome',
            'Get started',
            'Configure',
            'Features',
            'User guide',
            'Tutorials',
            'Reference'
        ]);
    });
});

describe('moving around', () => {
    it('a section of the header moves within the tab', async () => {
        await open();
        const link = $$('.rh-guide-nav-link').find(a => a.textContent === 'User guide');
        expect(link.getAttribute('href')).toBe('/lightning/n/Rowhouse_Guide?c__page=using');
        link.click();
        expect(mockNavigate).toHaveBeenCalledWith({
            type: 'standard__navItemPage',
            attributes: { apiName: 'Rowhouse_Guide' },
            state: { c__page: 'using' }
        });
    });

    it('goes back to the top for a new page, but not when it opens at a section', async () => {
        await open({ c__page: 'tutorials' });
        const tops = () => scrolled.filter(s => s.classList.contains('rh-guide')).length;
        expect(tops()).toBe(1);
        // eslint-disable-next-line @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit
        CurrentPageReference.emit({
            type: 'standard__navItemPage',
            attributes: { apiName: 'Rowhouse_Guide' },
            state: { c__page: 'reference', c__section: 'faq' }
        });
        await settle();
        expect(tops()).toBe(1);
        expect(scrolled.some(s => s.getAttribute('data-anchor') === 'faq')).toBe(true);
    });

    // The Tutorials page is the guide's largest, and checking all of it takes
    // about 40 seconds on a laptop and more than twice that on a GitHub runner.
    it('is accessible', async () => {
        await open({ c__page: 'tutorials' });
        await expect(el).toBeAccessible();
    }, 180000);
});
