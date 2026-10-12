/**
 * The owner search behind a row's Change Owner: with ownerSearch, the box
 * asks the server for the users and queues the grid's records can have, not
 * for a column's targets.
 */
import { createElement } from 'lwc';
import CellLookup, { SEARCH_DELAY_MS } from 'c/cellLookup';
import searchLookup from '@salesforce/apex/GridController.searchLookup';
import searchOwners from '@salesforce/apex/GridController.searchOwners';

jest.mock('@salesforce/apex/GridController.searchLookup', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.searchOwners', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const NORA = { id: '005000000000077AAA', name: 'Nora Pelletier', kind: 'User', object: 'User' };
const DOCK = { id: '00G000000000012AAA', name: 'Loading Dock Queue', kind: 'Queue', object: 'Group' };

let el;
let commits;
const input = () => el.shadowRoot.querySelector('input');

beforeEach(async () => {
    searchOwners.mockResolvedValue([NORA, DOCK]);
    el = createElement('c-cell-lookup', { is: CellLookup });
    Object.assign(el, { mode: 'edit', label: 'New Owner', configName: 'Consignments', ownerSearch: true });
    commits = [];
    el.addEventListener('commit', e => commits.push(e.detail));
    document.body.appendChild(el);
    await flush();
});
afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

it('asks for owners of the grid, and chooses one as any match', async () => {
    input().value = 'pel';
    input().dispatchEvent(new CustomEvent('input', { bubbles: true, composed: true }));
    await wait(SEARCH_DELAY_MS + 20);
    await flush();
    expect(searchOwners).toHaveBeenCalledWith({ configName: 'Consignments', term: 'pel' });
    expect(searchLookup).not.toHaveBeenCalled();
    const options = [...el.shadowRoot.querySelectorAll('[role="option"]')];
    expect(options.map(o => o.textContent)).toEqual(['Nora PelletierUser', 'Loading Dock QueueQueue']);
    options[1].click();
    expect(commits).toEqual([{ value: DOCK.id, label: 'Loading Dock Queue' }]);
});
