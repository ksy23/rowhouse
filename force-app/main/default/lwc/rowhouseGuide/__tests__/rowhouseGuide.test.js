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

/** The <style> elements of components no longer in the document (see "is accessible"). */
function staleStylesheets() {
    const live = new Set();
    const walk = root =>
        root.querySelectorAll('*').forEach(e => {
            e.getAttributeNames()
                .filter(a => a.endsWith('-host'))
                .forEach(a => live.add(a.slice(0, -'-host'.length)));
            if (e.shadowRoot) walk(e.shadowRoot);
        });
    walk(document.body);
    return [...document.head.querySelectorAll('style')].filter(s => {
        const scope = s.textContent.match(/\[(lwc-[a-z0-9]+)-host\]/);
        return scope && !live.has(scope[1]);
    });
}

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
        expect($('.rh-guide-footer').textContent.trim().replace(/\s+/g, ' ')).toBe(
            'Rowhouse by Kugamon is free and open source, under the Mozilla Public License 2.0. ' +
                'It is an independent project. ' +
                'It is not affiliated with, endorsed by or sponsored by Salesforce, Inc. ' +
                'Salesforce, Lightning and AppExchange are trademarks of Salesforce, Inc. ' +
                '“Rowhouse” and the Rowhouse logo are trademarks of Kugamon LLC.'
        );
    });

    it('opens Welcome for a page the guide does not have', async () => {
        await open({ c__page: 'release-notes' });
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

    // jsdom works out each element's style against every stylesheet in the
    // document, and LWC leaves a component's stylesheet behind after the
    // component is gone. By this test the guide's 115 KB stylesheet is there
    // once for every page the suite has opened, which made axe's style checks
    // take about three minutes on a GitHub runner. The copies left by
    // components no longer on the page are scoped to them and match nothing,
    // so they are set aside while axe runs and put back afterwards.
    it('is accessible', async () => {
        await open({ c__page: 'tutorials' });
        const stale = staleStylesheets();
        stale.forEach(s => s.remove());
        try {
            await expect(el).toBeAccessible();
        } finally {
            stale.forEach(s => document.head.appendChild(s));
        }
    });
});
