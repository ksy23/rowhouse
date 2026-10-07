/**
 * The Grid Admin tab's row dialog: a clone's title and API name, and
 * its deploy; archiving with the grids whose child table tab goes; restoring;
 * the records to delete in Setup, in order; and staying open while a deploy
 * runs.
 */
import { createElement } from 'lwc';
import GridAdminRowDialog, { copyTitle, freeName } from 'c/gridAdminRowDialog';
import archiveConfig from '@salesforce/apex/GridAdminController.archiveConfig';
import cloneConfig from '@salesforce/apex/GridAdminController.cloneConfig';
import setupRecords from '@salesforce/apex/GridAdminController.setupRecords';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';

jest.mock('@salesforce/apex/GridAdminController.archiveConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.cloneConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.setupRecords', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });

const GRID = { name: 'Account_People', label: 'Account People', usedBy: [] };
const NAMES = ['Account_People', 'Copy_of_Account_People', 'Deals'];

const settle = async () => {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];

let events;
async function mount(action, grid = GRID) {
    const el = createElement('c-grid-admin-row-dialog', { is: GridAdminRowDialog });
    el.action = action;
    el.grid = grid;
    el.names = NAMES;
    events = [];
    el.addEventListener('done', e => events.push({ type: 'done', detail: e.detail }));
    el.addEventListener('cancel', () => events.push({ type: 'cancel' }));
    document.body.appendChild(el);
    await settle();
    return el;
}
const type = async (el, selector, value) => {
    $(el, selector).dispatchEvent(new CustomEvent('change', { detail: { value } }));
    await settle();
};

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('names for a clone', () => {
    it('suggests "Copy of" the title, cut to 40 characters', () => {
        expect(copyTitle('Account People')).toBe('Copy of Account People');
        expect(copyTitle('A'.repeat(40)).length).toBe(40);
    });

    it('numbers the API name when another grid has it', () => {
        expect(freeName('Copy of Deals', NAMES)).toBe('Copy_of_Deals');
        expect(freeName('Copy of Account People', NAMES)).toBe('Copy_of_Account_People_2');
        expect(freeName('Copy of Account People', [...NAMES, 'copy_of_account_people_2'])).toBe(
            'Copy_of_Account_People_3'
        );
    });
});

describe('Clone', () => {
    it('starts from a free title and API name, the name following the title until it is typed', async () => {
        const el = await mount('clone');
        expect($(el, '.rh-row-dialog-heading').textContent).toBe('Clone Account People');
        expect($(el, '.rh-row-dialog-title').value).toBe('Copy of Account People');
        expect($(el, '.rh-row-dialog-name').value).toBe('Copy_of_Account_People_2');
        await type(el, '.rh-row-dialog-title', 'People by account');
        expect($(el, '.rh-row-dialog-name').value).toBe('People_by_account');
        await type(el, '.rh-row-dialog-name', 'My_People');
        await type(el, '.rh-row-dialog-title', 'Something else');
        expect($(el, '.rh-row-dialog-name').value).toBe('My_People');
    });

    it('will not clone without a title or with an API name that cannot be', async () => {
        const el = await mount('clone');
        await type(el, '.rh-row-dialog-name', 'Two__Underscores');
        expect($(el, '.rh-row-dialog-name-error').textContent).toContain('single underscores');
        expect($(el, '.rh-row-dialog-confirm').disabled).toBe(true);
        await type(el, '.rh-row-dialog-name', 'Good_Name');
        await type(el, '.rh-row-dialog-title', '   ');
        expect($(el, '.rh-row-dialog-confirm').disabled).toBe(true);
    });

    it('deploys the copy, waits for it, and says it went through', async () => {
        cloneConfig.mockResolvedValue('0Af000000000001');
        saveStatus
            .mockResolvedValueOnce({ status: 'pending' })
            .mockResolvedValueOnce({ status: 'Succeeded', messages: [] });
        const el = await mount('clone');
        $(el, '.rh-row-dialog-confirm').click();
        await settle();
        expect(cloneConfig).toHaveBeenCalledWith({
            sourceName: 'Account_People',
            label: 'Copy of Account People',
            name: 'Copy_of_Account_People_2'
        });
        expect($(el, '.rh-row-dialog-working').textContent).toContain('Cloning');
        expect($(el, '.rh-row-dialog-cancel').disabled).toBe(true);
        $(el, '.rh-row-dialog-cancel').click();
        expect(events).toEqual([]);
        jest.advanceTimersByTime(1000);
        await settle();
        jest.advanceTimersByTime(1500);
        await settle();
        expect(saveStatus).toHaveBeenCalledWith({ jobId: '0Af000000000001' });
        expect(events).toEqual([{ type: 'done', detail: { action: 'clone', configName: 'Copy_of_Account_People_2' } }]);
    });

    it('says why the server refused it, and stays open', async () => {
        cloneConfig.mockRejectedValue({
            body: { message: 'A grid named Deals already exists. Choose another API name.' }
        });
        const el = await mount('clone');
        await type(el, '.rh-row-dialog-name', 'Deals');
        $(el, '.rh-row-dialog-confirm').click();
        await settle();
        expect($(el, '.rh-row-dialog-error').textContent).toBe(
            'A grid named Deals already exists. Choose another API name.'
        );
        expect($(el, '.rh-row-dialog-confirm').disabled).toBe(false);
        expect(events).toEqual([]);
    });

    it('says what the deploy reported when it failed', async () => {
        cloneConfig.mockResolvedValue('0Af000000000002');
        saveStatus.mockResolvedValue({ status: 'Failed', messages: ['Grid_Column__mdt.X: Something went wrong'] });
        const el = await mount('clone');
        $(el, '.rh-row-dialog-confirm').click();
        await settle();
        jest.advanceTimersByTime(1000);
        await settle();
        expect($(el, '.rh-row-dialog-error').textContent).toBe(
            'It did not go through. Grid_Column__mdt.X: Something went wrong'
        );
    });
});

describe('Archive and Restore', () => {
    it('says what archiving does, and which grids lose a child table tab', async () => {
        const el = await mount('archive', { ...GRID, usedBy: ['Accounts', 'Key Accounts'] });
        expect($(el, '.rh-row-dialog-heading').textContent).toBe('Archive Account People?');
        expect($(el, '.rh-row-dialog-lede').textContent).toContain('goes to Archived grids, where you can restore it');
        expect($(el, '.rh-row-dialog-used-by').textContent).toBe(
            'Accounts and Key Accounts show it as a child table: that tab is hidden while it is archived.'
        );
        expect($(el, '.rh-row-dialog-confirm').textContent).toBe('Archive');
    });

    it('archives: the configuration, Archived ticked', async () => {
        archiveConfig.mockResolvedValue('0Af000000000003');
        saveStatus.mockResolvedValue({ status: 'Succeeded', messages: [] });
        const el = await mount('archive');
        expect($(el, '.rh-row-dialog-used-by')).toBeNull();
        $(el, '.rh-row-dialog-confirm').click();
        await settle();
        jest.advanceTimersByTime(1000);
        await settle();
        expect(archiveConfig).toHaveBeenCalledWith({ configName: 'Account_People', archived: true });
        expect(events).toEqual([{ type: 'done', detail: { action: 'archive', configName: 'Account_People' } }]);
    });

    it('restores: Archived unticked', async () => {
        archiveConfig.mockResolvedValue('0Af000000000004');
        saveStatus.mockResolvedValue({ status: 'Succeeded', messages: [] });
        const el = await mount('restore', { ...GRID, usedBy: ['Accounts'] });
        expect($(el, '.rh-row-dialog-heading').textContent).toBe('Restore Account People?');
        expect($(el, '.rh-row-dialog-used-by')).toBeNull();
        $(el, '.rh-row-dialog-confirm').click();
        await settle();
        jest.advanceTimersByTime(1000);
        await settle();
        expect(archiveConfig).toHaveBeenCalledWith({ configName: 'Account_People', archived: false });
        expect(events[0].detail.action).toBe('restore');
    });
});

describe('Delete in Setup', () => {
    it('lists the records to delete, in order, each a link to its page in Setup', async () => {
        setupRecords.mockResolvedValue([
            {
                kind: 'Grid Child Table',
                label: 'People',
                name: 'Accounts_People',
                url: '/lightning/setup/CustomMetadata/page?address=%2Fm03A',
                note: 'A child table of Accounts that shows this grid.'
            },
            {
                kind: 'Grid Column',
                label: 'Name',
                name: 'Account_People_Name',
                url: '/lightning/setup/CustomMetadata/page?address=%2Fm01A',
                note: null
            },
            {
                kind: 'Grid Configuration',
                label: 'Account People',
                name: 'Account_People',
                url: '/lightning/setup/CustomMetadata/page?address=%2Fm00A',
                note: 'The grid itself: delete it last.'
            }
        ]);
        const el = await mount('setup');
        expect(setupRecords).toHaveBeenCalledWith({ configName: 'Account_People' });
        expect($(el, '.rh-row-dialog-heading').textContent).toBe('Delete Account People in Setup');
        expect($(el, '.rh-row-dialog-lede').textContent).toContain('only Setup can delete Custom Metadata records');
        const links = $$(el, '.rh-row-dialog-record a');
        expect(links.map(a => a.textContent)).toEqual([
            'Grid Child Table: People',
            'Grid Column: Name',
            'Grid Configuration: Account People'
        ]);
        expect(links[2].getAttribute('href')).toBe('/lightning/setup/CustomMetadata/page?address=%2Fm00A');
        expect(links[2].getAttribute('target')).toBe('_blank');
        expect($$(el, '.rh-row-dialog-record-name').map(s => s.textContent)).toEqual([
            'Accounts_People',
            'Account_People_Name',
            'Account_People'
        ]);
        expect($$(el, '.rh-row-dialog-record-note').map(s => s.textContent)).toEqual([
            'A child table of Accounts that shows this grid.',
            'The grid itself: delete it last.'
        ]);
        expect($(el, '.rh-row-dialog-confirm')).toBeNull();
        $(el, '.rh-row-dialog-cancel').click();
        expect(events).toEqual([{ type: 'cancel' }]);
    });
});

it('closes on Escape, and starts on the safe choice', async () => {
    const el = await mount('archive');
    expect(el.shadowRoot.activeElement).toBe($(el, '.rh-row-dialog-cancel'));
    $(el, '.rh-row-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events).toEqual([{ type: 'cancel' }]);
});

it('is accessible, asking and listing', async () => {
    setupRecords.mockResolvedValue([
        {
            kind: 'Grid Configuration',
            label: 'Account People',
            name: 'Account_People',
            url: '/lightning/setup/CustomMetadata/page?address=%2Fm00A',
            note: 'The grid itself: delete it last.'
        }
    ]);
    jest.useRealTimers();
    for (const action of ['clone', 'archive', 'setup']) {
        // eslint-disable-next-line no-await-in-loop
        const el = await mount(action);
        // eslint-disable-next-line no-await-in-loop
        await expect(el).toBeAccessible();
        el.remove();
    }
});
