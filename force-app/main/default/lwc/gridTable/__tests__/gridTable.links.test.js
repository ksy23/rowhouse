/**
 * Links in cells: the record's name opens the record, an email address
 * writes to it, a phone number dials it, a web address opens a new tab. A
 * record link is followed through Lightning's navigation, as a list view's
 * are, unless a modifier key asks the browser for a new tab or window.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

const mockNavigate = jest.fn();
jest.mock(
    'lightning/navigation',
    () => {
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
        // gridView, under a row's related records, reads the page it is on.
        // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
        const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
        return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
    }
    // Not virtual: the module resolves to sfdx-lwc-jest's stub, and a virtual
    // mock would miss a module ID cached by an earlier suite in the same worker.
);

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const ID = 'a01000000000001AAA';
const ACC = '001000000000002AAA';
const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
    { field: 'Email__c', label: 'Email', type: 'email', editable: true, sortable: true },
    { field: 'Phone__c', label: 'Phone', type: 'phone', editable: true, sortable: true },
    { field: 'Web__c', label: 'Web', type: 'url', editable: true, sortable: true },
    { field: 'Account__c', label: 'Account', type: 'reference', editable: true, sortable: true, referenceTo: ['Account'] }
];
const ROW = { Id: ID, Name: 'TC-001', Email__c: 'ada@example.com', Phone__c: '+1 (415) 555-0100', Web__c: 'https://example.com', Account__c: ACC };

let el;
const mount = async (row = ROW) => {
    el = createElement('rowhouse-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: [row], refNames: { [ACC]: 'Alpha Corp' } };
    document.body.appendChild(el);
    await flush();
};
const link = field => el.shadowRoot.querySelector(`td[data-row-id="${ID}"][data-field="${field}"] a`);
/**
 * Click a link; returns whether the grid kept the browser from following it.
 * The page then stops the browser in every case: JSDOM cannot navigate.
 */
const click = (a, init = {}) => {
    let prevented = null;
    const stop = e => {
        prevented = e.defaultPrevented;
        e.preventDefault();
    };
    document.addEventListener('click', stop);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, ...init }));
    document.removeEventListener('click', stop);
    return { defaultPrevented: prevented };
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    mockNavigate.mockClear();
});

describe('links in cells', () => {
    it('links the record\'s name to the record', async () => {
        await mount();
        expect(link('Name').getAttribute('href')).toBe(`/lightning/r/${ID}/view`);
        expect(link('Name').textContent).toBe('TC-001');
        expect(link('Name').getAttribute('target')).toBeNull();
    });

    it('writes to an email address, dials a phone number, opens a web address in a new tab', async () => {
        await mount();
        expect(link('Email__c').getAttribute('href')).toBe('mailto:ada@example.com');
        expect(link('Phone__c').getAttribute('href')).toBe('tel:+14155550100');
        expect(link('Web__c').getAttribute('href')).toBe('https://example.com');
        expect(link('Web__c').getAttribute('target')).toBe('_blank');
        expect(link('Web__c').getAttribute('rel')).toContain('noopener');
    });

    it('leaves a malformed email address as plain text', async () => {
        await mount({ ...ROW, Email__c: 'not an address' });
        expect(link('Email__c')).toBeNull();
        expect(el.shadowRoot.querySelector(`td[data-row-id="${ID}"][data-field="Email__c"]`).textContent).toContain('not an address');
    });

    it('follows a record link through Lightning, in the same tab', async () => {
        await mount();
        const event = click(link('Account__c'));
        expect(event.defaultPrevented).toBe(true);
        expect(mockNavigate).toHaveBeenCalledWith({ type: 'standard__recordPage', attributes: { recordId: ACC, actionName: 'view' } });
    });

    it('leaves a click with Cmd, Ctrl or Shift to the browser: a new tab or window', async () => {
        await mount();
        ['metaKey', 'ctrlKey', 'shiftKey'].forEach(mod => {
            const event = click(link('Name'), { [mod]: true });
            expect(event.defaultPrevented).toBe(false);
        });
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('does not navigate for an email or phone link', async () => {
        await mount();
        click(link('Email__c'));
        click(link('Phone__c'));
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
