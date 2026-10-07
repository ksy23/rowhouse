/**
 * The Grid Guide tab for someone who is not a grid admin: the sections
 * for users only, and a note in place of an admin page.
 */
import { createElement } from 'lwc';
import RowhouseGuide from 'c/rowhouseGuide';
import { CurrentPageReference } from 'lightning/navigation';

jest.mock('@salesforce/customPermission/Rowhouse_Admin', () => ({ default: undefined }), { virtual: true });

jest.mock('lightning/navigation', () => {
    // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    const NavigationMixin = Base => class extends Base {};
    NavigationMixin.Navigate = Symbol('Navigate');
    NavigationMixin.GenerateUrl = Symbol('GenerateUrl');
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

beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

it('shows the sections for users', async () => {
    await open();
    expect([...el.shadowRoot.querySelectorAll('.rh-guide-nav-link')].map(a => a.textContent)).toEqual([
        'Welcome',
        'User guide',
        'Tutorials',
        'Reference'
    ]);
});

it('says an admin page is for grid admins, and points to the User guide', async () => {
    await open({ c__page: 'configure', c__section: 'filter' });
    expect($('c-guide-content')).toBeNull();
    expect($('.rh-guide-admin-only h2').textContent).toBe('This page is for grid admins');
    expect($('.rh-guide-admin-only').textContent).toContain(
        '"Configuration reference" is for the people who build grids'
    );
    expect($('.rh-guide-admin-only a').getAttribute('href')).toBe('/lightning/n/Rowhouse_Guide?c__page=using');
});

it('opens a page for users as usual', async () => {
    await open({ c__page: 'using', c__section: 'keys' });
    expect($('c-guide-content').page).toBe('using');
    expect($('c-guide-content').section).toBe('keys');
});
