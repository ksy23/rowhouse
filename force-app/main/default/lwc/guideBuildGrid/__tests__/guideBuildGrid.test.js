/**
 * A tutorial's Build button: who sees it, what the dialog says the org
 * already has, building each missing grid in turn (a child table's grid
 * first), a failure part-way, and the dialog's focus and Escape.
 */
import { createElement } from 'lwc';
import GuideBuildGrid, { listed, planFor } from 'c/guideBuildGrid';
import { gridsFor } from 'c/guideTutorialGrids';
import canSave from '@salesforce/apex/GridAdminController.canSave';
import listConfigs from '@salesforce/apex/GridAdminController.listConfigs';
import saveDraft from '@salesforce/apex/GridAdminController.saveDraft';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';

jest.mock('@salesforce/apex/GridAdminController.canSave', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.listConfigs', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });

const settle = async () => {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];

let toasts;
async function mount(tutorial) {
    const el = createElement('c-guide-build-grid', { is: GuideBuildGrid });
    el.tutorial = tutorial;
    toasts = [];
    el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
    document.body.appendChild(el);
    await settle();
    return el;
}

async function open(el) {
    $(el, '.rh-build-open').click();
    await settle();
}

/** Let one deploy's status check run. */
async function tick() {
    jest.advanceTimersByTime(1000);
    await settle();
}

const saved = () => saveDraft.mock.calls.map(([arg]) => JSON.parse(arg.draftJson).config.name);

beforeEach(() => {
    jest.useFakeTimers();
    canSave.mockResolvedValue(true);
    listConfigs.mockResolvedValue([]);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('who sees the button', () => {
    it('a grid admin who can save: the button, named after the grid', async () => {
        const el = await mount('tutorial-leads');
        expect($(el, '.rh-build-open').textContent).toBe('Build Lead Queue');
        expect($(el, '.rh-build-cannot')).toBeNull();
    });

    it('names how many grids when a tutorial has several', async () => {
        const el = await mount('tutorial-accounts');
        expect($(el, '.rh-build-open').textContent).toBe('Build the 3 grids');
    });

    it('anyone else: who can build it, and no button', async () => {
        canSave.mockResolvedValue(false);
        const el = await mount('tutorial-leads');
        expect($(el, '.rh-build-open')).toBeNull();
        expect($(el, '.rh-build-cannot').textContent).toBe(
            'To build this grid here in one click, you need the Rowhouse Grid Admin permission set and Customize Application.'
        );
    });

    it('someone who cannot call the Grid Admin tab at all: the same', async () => {
        canSave.mockRejectedValue({
            body: { message: 'You do not have access to the Apex class named GridAdminController.' }
        });
        const el = await mount('tutorial-groups');
        expect($(el, '.rh-build-open')).toBeNull();
        expect($(el, '.rh-build-cannot').textContent).toContain('To build these grids here');
    });

    it('a page with no grids to build: nothing', async () => {
        const el = await mount('tutorials');
        expect($(el, '.rh-build-open')).toBeNull();
        expect($(el, '.rh-build-cannot')).toBeNull();
    });
});

describe('the dialog', () => {
    it('names each grid and what it holds', async () => {
        const el = await mount('tutorial-groups');
        await open(el);
        expect($(el, '.rh-build-heading').textContent).toBe('Build the 2 grids for this tutorial?');
        expect($$(el, '.rh-build-item').map(li => li.textContent)).toEqual([
            'Subsidiaries (Subsidiaries)Account: 4 columns.',
            'Account Groups (Account_Groups)Account: 6 columns, 1 display rule, 1 filter and 1 child table.'
        ]);
        expect($(el, '.rh-build-confirm').textContent.trim()).toBe('Build');
        expect(el.shadowRoot.activeElement).toBe($(el, '.rh-build-cancel'));
    });

    it('uses a grid the org already has, and builds only the rest', async () => {
        listConfigs.mockResolvedValue([{ name: 'Subsidiaries', objectApiName: 'Account', archived: false }]);
        const el = await mount('tutorial-groups');
        await open(el);
        expect($$(el, '.rh-build-item')[0].textContent).toBe(
            'Subsidiaries (Subsidiaries)Already in this org: used as it is, not changed.'
        );
        saveDraft.mockResolvedValue('0Af000000000001');
        saveStatus.mockResolvedValue({ status: 'Succeeded', messages: [] });
        $(el, '.rh-build-confirm').click();
        await settle();
        await tick();
        expect(saved()).toEqual(['Account_Groups']);
    });

    it('says so when every grid is there already, with nothing to build', async () => {
        listConfigs.mockResolvedValue([{ name: 'Lead_Queue', objectApiName: 'Lead', archived: false }]);
        const el = await mount('tutorial-leads');
        await open(el);
        expect($(el, '.rh-build-heading').textContent).toBe('Lead Queue is already in this org');
        expect($(el, '.rh-build-item').textContent).toBe('Lead Queue (Lead_Queue)Already in this org.');
        expect($(el, '.rh-build-lede').textContent).toBe(
            'This org already has every grid this tutorial builds. Open the Grid Admin tab to see or change them.'
        );
        expect($(el, '.rh-build-confirm')).toBeNull();
        expect($(el, '.rh-build-cancel').textContent.trim()).toBe('Close');
    });

    it('will not build over a grid of the same name on another object', async () => {
        listConfigs.mockResolvedValue([{ name: 'Lead_Queue', objectApiName: 'Contact', objectLabel: 'Contacts' }]);
        const el = await mount('tutorial-leads');
        await open(el);
        expect($(el, '.rh-build-item').textContent).toBe(
            'Lead Queue (Lead_Queue)A grid with this API name already shows Contacts, so it cannot be built here.'
        );
        expect($(el, '.rh-build-confirm')).toBeNull();
        expect($(el, '.rh-build-after').textContent).toContain('on the Grid Admin tab instead');
    });

    it('Cancel and Escape close it, and focus goes back to the button', async () => {
        const el = await mount('tutorial-leads');
        await open(el);
        $(el, '.rh-build-cancel').click();
        await settle();
        expect($(el, 'section[role="dialog"]')).toBeNull();
        expect(el.shadowRoot.activeElement).toBe($(el, '.rh-build-open'));
        await open(el);
        $(el, 'section[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();
        expect($(el, 'section[role="dialog"]')).toBeNull();
    });
});

describe('building', () => {
    it("saves each grid in turn, a child table's grid first, waiting for each deploy", async () => {
        saveDraft.mockResolvedValueOnce('0Af000000000001').mockResolvedValueOnce('0Af000000000002');
        saveStatus
            .mockResolvedValueOnce({ status: 'pending' })
            .mockResolvedValueOnce({ status: 'Succeeded', messages: [] })
            .mockResolvedValueOnce({ status: 'Succeeded', messages: [] });
        const el = await mount('tutorial-assets');
        await open(el);
        $(el, '.rh-build-confirm').click();
        await settle();
        expect($(el, '.rh-build-progress').textContent).toBe(
            'Building Account Assets (1 of 2). This takes a few seconds.'
        );
        expect(saved()).toEqual(['Account_Assets']);
        expect($(el, '.rh-build-cancel').disabled).toBe(true);
        await tick();
        jest.advanceTimersByTime(1500);
        await settle();
        expect(saved()).toEqual(['Account_Assets', 'Installed_Base']);
        await tick();
        expect($(el, 'section[role="dialog"]')).toBeNull();
        expect($(el, '.rh-build-done').textContent).toBe('Built: Account Assets and Installed Base.');
        expect(toasts).toEqual([
            expect.objectContaining({
                title: 'The grids are built',
                message: 'Account Assets and Installed Base are in this org now, on the Grid Admin tab.',
                variant: 'success'
            })
        ]);
    });

    it('shows a spinner while it builds, with the buttons off and focus on the spinner', async () => {
        saveDraft.mockResolvedValue('0Af000000000001');
        saveStatus
            .mockResolvedValueOnce({ status: 'pending' })
            .mockResolvedValueOnce({ status: 'Succeeded', messages: [] });
        const el = await mount('tutorial-leads');
        await open(el);
        $(el, '.rh-build-confirm').click();
        await settle();
        const busy = $(el, '.rh-build-busy');
        expect(busy).not.toBeNull();
        expect($(el, '.rh-build-busy lightning-spinner').alternativeText).toBe('Building the grids');
        expect($(el, '.rh-build-progress').textContent).toBe('Building Lead Queue. This takes a few seconds.');
        expect($(el, '.rh-build-busy-note').textContent).toBe('Keep this window open until it is done.');
        expect($(el, '.rh-build-items')).toBeNull();
        expect($(el, '.rh-build-confirm').disabled).toBe(true);
        expect($(el, '.rh-build-close').disabled).toBe(true);
        expect(el.shadowRoot.activeElement).toBe(busy);
        $(el, 'section[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();
        expect($(el, 'section[role="dialog"]')).not.toBeNull();
        await tick();
        expect($(el, '.rh-build-busy')).not.toBeNull(); // still pending
        jest.advanceTimersByTime(1500);
        await settle();
        expect($(el, 'section[role="dialog"]')).toBeNull();
    });

    it("sends the tutorial's draft as it is", async () => {
        saveDraft.mockResolvedValue('0Af000000000001');
        saveStatus.mockResolvedValue({ status: 'Succeeded', messages: [] });
        const el = await mount('tutorial-leads');
        await open(el);
        $(el, '.rh-build-confirm').click();
        await settle();
        expect(JSON.parse(saveDraft.mock.calls[0][0].draftJson)).toEqual(gridsFor('tutorial-leads')[0]);
    });

    it('stops at a grid that fails, and says which were built', async () => {
        saveDraft.mockResolvedValueOnce('0Af000000000001').mockResolvedValueOnce('0Af000000000002');
        saveStatus.mockResolvedValueOnce({ status: 'Succeeded', messages: [] }).mockResolvedValueOnce({
            status: 'Failed',
            messages: [
                'Grid_Child__mdt.Key_Accounts_Deals: An unexpected error occurred. Please include this ErrorId if you contact support: 1873290553-41729 (-1404846893)'
            ]
        });
        const el = await mount('tutorial-accounts');
        await open(el);
        $(el, '.rh-build-confirm').click();
        await settle();
        await tick();
        await tick();
        expect(saved()).toEqual(['Key_Account_Contacts', 'Key_Account_Deals']);
        expect($(el, '.rh-build-error').textContent).toBe(
            'Key Account Deals was not built. Grid_Child__mdt.Key_Accounts_Deals: An unexpected error occurred. Please include this ErrorId if you contact support: 1873290553-41729 (-1404846893). Key Account Contacts was built and stays.'
        );
        expect($(el, '.rh-build-cancel').disabled).toBe(false);
        expect($(el, '.rh-build-busy')).toBeNull();
        expect($(el, '.rh-build-items')).not.toBeNull();
        expect(el.shadowRoot.activeElement).toBe($(el, '.rh-build-cancel'));
        expect(toasts).toEqual([]);
    });

    it('says why the server refused one', async () => {
        saveDraft.mockRejectedValue({ body: { message: 'Saving a grid needs the Customize Application permission.' } });
        const el = await mount('tutorial-leads');
        await open(el);
        $(el, '.rh-build-confirm').click();
        await settle();
        expect($(el, '.rh-build-error').textContent).toBe(
            'Lead Queue was not built. Saving a grid needs the Customize Application permission.'
        );
    });
});

describe('the plan', () => {
    it('matches names without regard to case, and notes an archived grid', () => {
        const plan = planFor(gridsFor('tutorial-groups'), [
            { name: 'subsidiaries', objectApiName: 'account', archived: true }
        ]);
        expect(plan.map(p => [p.name, p.exists, p.archived, p.clash])).toEqual([
            ['Subsidiaries', true, true, false],
            ['Account_Groups', false, false, false]
        ]);
    });

    it('lists like a sentence', () => {
        expect(listed(['Lead Queue'])).toBe('Lead Queue');
        expect(listed(['Account Assets', 'Installed Base'])).toBe('Account Assets and Installed Base');
        expect(listed(['Key Account Contacts', 'Key Account Deals', 'Key Accounts'])).toBe(
            'Key Account Contacts, Key Account Deals and Key Accounts'
        );
    });
});

describe('accessibility', () => {
    it('the dialog passes axe', async () => {
        jest.useRealTimers();
        const el = await mount('tutorial-groups');
        await open(el);
        await expect(el).toBeAccessible();
    });
});
