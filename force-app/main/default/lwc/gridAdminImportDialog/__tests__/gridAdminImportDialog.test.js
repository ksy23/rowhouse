/**
 * The Grid Admin tab's import dialog: choosing a file, what importing does
 * with each grid before anything is saved (new, left as it is, or a copy),
 * what keeps a grid out, importing one after the other, and stopping at a
 * grid that fails with the ones before it kept.
 */
import { createElement } from 'lwc';
import GridAdminImportDialog, { describeItem, importable } from 'c/gridAdminImportDialog';
import planImport from '@salesforce/apex/GridAdminController.planImport';
import saveDraft from '@salesforce/apex/GridAdminController.saveDraft';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';
import { NOT_A_GRID_FILE } from 'c/gridConfigFile';

jest.mock('@salesforce/apex/GridAdminController.planImport', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
// A chosen file's text, without jsdom's FileReader: the file here carries it.
jest.mock('c/gridConfigFile', () => {
    const actual = jest.requireActual('c/gridConfigFile');
    return {
        ...actual,
        readText: jest.fn(file =>
            file.problem ? Promise.reject(new Error(file.problem)) : Promise.resolve(file.content)
        )
    };
});

const grid = (name, objectApiName, extra = {}) => ({
    config: { name, label: name.replace(/_/g, ' '), objectApiName },
    columns: [{ field: 'Name' }, { field: 'Pieces__c' }],
    rules: [],
    filters: [],
    actions: [],
    children: [],
    ...extra
});
const FILE_GRIDS = [
    grid('Harbor_Items', 'Consignment_Item__c'),
    grid('Harbor_Consignments', 'Consignment__c', { children: [{ childConfig: 'Harbor_Items' }] }),
    grid('Consignments', 'Consignment__c')
];
const FILE = {
    name: 'rowhouse-grids-2026-10-11.json',
    content: JSON.stringify({ kind: 'rowhouse-grids', version: 1, exported: '', grids: FILE_GRIDS })
};
const item = (name, action, extra = {}) => ({
    name,
    label: name.replace(/_/g, ' '),
    objectApiName: 'Consignment__c',
    objectLabel: 'Consignments',
    action,
    importName: name,
    importLabel: name.replace(/_/g, ' '),
    errors: [],
    warnings: [],
    draft: action === 'skip' ? null : { config: { name, isNew: true } },
    ...extra
});
const PLAN = [
    item('Harbor_Items', 'new', { objectLabel: 'Consignment Items' }),
    item('Harbor_Consignments', 'new'),
    item('Consignments', 'skip', { existingObjectLabel: 'Consignments', importLabel: 'Consignments' })
];

const settle = async () => {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];

let events;
async function mount() {
    const el = createElement('c-grid-admin-import-dialog', { is: GridAdminImportDialog });
    events = [];
    el.addEventListener('done', e => events.push({ type: 'done', detail: e.detail }));
    el.addEventListener('cancel', e => events.push({ type: 'cancel', detail: e.detail }));
    document.body.appendChild(el);
    await settle();
    return el;
}
async function choose(el, file) {
    const input = $(el, '.rh-import-grids-file');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new CustomEvent('change'));
    await settle();
}
const texts = el => $$(el, '.rh-import-grids-text').map(t => t.textContent);

beforeEach(() => {
    jest.useFakeTimers();
    planImport.mockResolvedValue(PLAN);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('choosing a file', () => {
    it('starts on the file chooser, focused, with nothing to import yet', async () => {
        const el = await mount();
        expect($(el, '.rh-import-grids-heading').textContent).toBe('Import grids');
        expect(el.shadowRoot.activeElement).toBe($(el, '.rh-import-grids-file'));
        expect($(el, '.rh-import-grids-file').accept).toBe('.json,application/json');
        expect($(el, '.rh-import-grids-confirm')).toBeNull();
        expect($(el, '.rh-import-grids-cancel').textContent).toBe('Cancel');
    });

    it('refuses a file that is not a grid file, and stays on the chooser', async () => {
        const el = await mount();
        await choose(el, { name: 'contacts.csv', content: 'First Name,Last Name\nAva,Doucette' });
        expect($(el, '.rh-import-grids-error').textContent).toBe(NOT_A_GRID_FILE);
        expect($(el, '.rh-import-grids-file')).not.toBeNull();
        expect(planImport).not.toHaveBeenCalled();
        await choose(el, { name: 'big.json', problem: 'The file is larger than 2 MB. Export fewer grids at a time.' });
        expect($(el, '.rh-import-grids-error').textContent).toBe(
            'The file is larger than 2 MB. Export fewer grids at a time.'
        );
    });

    it('says why the server refused the file', async () => {
        planImport.mockRejectedValue({ body: { message: 'This needs the Rowhouse Grid Admin permission set.' } });
        const el = await mount();
        await choose(el, FILE);
        expect($(el, '.rh-import-grids-error').textContent).toBe('This needs the Rowhouse Grid Admin permission set.');
        expect($(el, '.rh-import-grids-file')).not.toBeNull();
    });
});

describe('before anything is saved', () => {
    it('shows what importing does with each grid, in the order it saves them', async () => {
        const el = await mount();
        await choose(el, FILE);
        expect(planImport).toHaveBeenCalledWith({ gridsJson: JSON.stringify(FILE_GRIDS), asCopies: false });
        expect($(el, '.rh-import-grids-count').textContent).toContain('rowhouse-grids-2026-10-11.json: 3 grids');
        expect($$(el, '.rh-import-grids-title').map(t => t.textContent)).toEqual([
            'Harbor Items (Harbor_Items)',
            'Harbor Consignments (Harbor_Consignments)',
            'Consignments (Consignments)'
        ]);
        expect(texts(el)).toEqual([
            'New: Consignment Items, 2 columns.',
            'New: Consignments, 2 columns and 1 child table.',
            'This org already has a grid named Consignments: left as it is.'
        ]);
        expect($(el, '.rh-import-grids-lede').textContent).toBe(
            'Rowhouse saves these 2 grids in this org, one after the other. A grid this org already has is never changed.'
        );
        expect($(el, '.rh-import-grids-existing').value).toBe('keep');
        expect($(el, '.rh-import-grids-confirm').textContent).toBe('Import 2 grids');
        expect(saveDraft).not.toHaveBeenCalled();
    });

    it('asks again when grids this org has are to be imported as copies', async () => {
        const el = await mount();
        await choose(el, FILE);
        planImport.mockResolvedValue([
            PLAN[0],
            PLAN[1],
            item('Consignments', 'copy', { importName: 'Copy_of_Consignments', importLabel: 'Copy of Consignments' })
        ]);
        $(el, '.rh-import-grids-existing').dispatchEvent(new CustomEvent('change', { detail: { value: 'copies' } }));
        await settle();
        expect(planImport).toHaveBeenLastCalledWith({ gridsJson: JSON.stringify(FILE_GRIDS), asCopies: true });
        expect(texts(el)[2]).toBe(
            'This org already has a grid named Consignments, so it is imported as Copy of Consignments (Copy_of_Consignments). Consignments: 2 columns.'
        );
        expect($(el, '.rh-import-grids-confirm').textContent).toBe('Import 3 grids');
    });

    it('offers no choice when the org has none of the grids', async () => {
        planImport.mockResolvedValue([PLAN[0]]);
        const el = await mount();
        await choose(el, FILE);
        expect($(el, '.rh-import-grids-existing')).toBeNull();
        expect($(el, '.rh-import-grids-lede').textContent).toBe(
            'Rowhouse saves this grid in this org. A grid this org already has is never changed.'
        );
        expect($(el, '.rh-import-grids-confirm').textContent).toBe('Import 1 grid');
    });

    it('shows what keeps a grid out, and what a grid would leave out', async () => {
        planImport.mockResolvedValue([
            item('Harbor_Items', 'new', {
                warnings: ['Grid Column Harbor_Items_Pieces was skipped: a sum of a name.']
            }),
            item('Harbor_Consignments', 'new', {
                draft: null,
                errors: ['No field Hull_Number__c on Consignments.']
            })
        ]);
        const el = await mount();
        await choose(el, FILE);
        const rows = $$(el, '.rh-import-grids-item');
        expect(rows[0].querySelector('.rh-import-grids-warnings').textContent).toContain('a sum of a name');
        expect(rows[1].className).toContain('rh-import-grids-item_error');
        expect(rows[1].querySelector('.rh-import-grids-text').textContent).toBe('Cannot be imported:');
        expect(rows[1].querySelector('.rh-import-grids-problems').textContent).toBe(
            'No field Hull_Number__c on Consignments.'
        );
        expect($(el, '.rh-import-grids-confirm').textContent).toBe('Import 1 grid');
    });

    it('says when the org already has every grid, and offers no import', async () => {
        planImport.mockResolvedValue([PLAN[2]]);
        const el = await mount();
        await choose(el, FILE);
        expect($(el, '.rh-import-grids-lede').textContent).toBe(
            'This org already has every grid in this file. Nothing is imported.'
        );
        expect($(el, '.rh-import-grids-confirm').disabled).toBe(true);
        expect($(el, '.rh-import-grids-confirm').textContent).toBe('Import');
    });

    it('goes back to the chooser for another file', async () => {
        const el = await mount();
        await choose(el, FILE);
        $(el, '.rh-import-grids-another').click();
        await settle();
        expect($(el, '.rh-import-grids-file')).not.toBeNull();
        expect($(el, '.rh-import-grids-confirm')).toBeNull();
    });
});

describe('importing', () => {
    const succeed = async rounds => {
        for (let i = 0; i < rounds; i++) {
            jest.advanceTimersByTime(1000);
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
    };

    it('saves the grids one after the other, child grids first, and says which were left as they were', async () => {
        saveDraft.mockResolvedValueOnce('0Af000000000001').mockResolvedValueOnce('0Af000000000002');
        saveStatus.mockResolvedValue({ status: 'Succeeded', messages: [] });
        const el = await mount();
        await choose(el, FILE);
        $(el, '.rh-import-grids-confirm').click();
        await settle();
        expect($(el, '.rh-import-grids-progress').textContent).toBe(
            'Importing Harbor Items (1 of 2). This takes a few seconds.'
        );
        expect($(el, '.rh-import-grids-cancel').disabled).toBe(true);
        expect($(el, '.rh-import-grids-existing').disabled).toBe(true);
        await succeed(2);
        expect(saveDraft.mock.calls.map(c => JSON.parse(c[0].draftJson).config.name)).toEqual([
            'Harbor_Items',
            'Harbor_Consignments'
        ]);
        expect(saveStatus).toHaveBeenCalledWith({ jobId: '0Af000000000002' });
        expect(events).toEqual([
            {
                type: 'done',
                detail: { imported: ['Harbor Items', 'Harbor Consignments'], skipped: ['Consignments'] }
            }
        ]);
    });

    it('stops at a grid that fails, keeps the ones before it, and says so', async () => {
        saveDraft.mockResolvedValueOnce('0Af000000000001').mockResolvedValueOnce('0Af000000000002');
        saveStatus
            .mockResolvedValueOnce({ status: 'Succeeded', messages: [] })
            .mockResolvedValueOnce({ status: 'Failed', messages: ['Harbor_Items is not a grid here yet'] });
        const el = await mount();
        await choose(el, FILE);
        $(el, '.rh-import-grids-confirm').click();
        await settle();
        await succeed(2);
        expect($(el, '.rh-import-grids-error').textContent).toBe(
            'Harbor Consignments was not imported. Harbor_Items is not a grid here yet. Harbor Items was imported and stays.'
        );
        expect(events).toEqual([]);
        expect($(el, '.rh-import-grids-cancel').textContent).toBe('Close');
        $(el, '.rh-import-grids-cancel').click();
        expect(events).toEqual([{ type: 'cancel', detail: { imported: ['Harbor Items'] } }]);
    });

    it('says why the server refused a save', async () => {
        saveDraft.mockRejectedValue({
            body: {
                message: 'Saving a grid needs the Customize Application permission as well as Rowhouse Grid Admin.'
            }
        });
        const el = await mount();
        await choose(el, FILE);
        $(el, '.rh-import-grids-confirm').click();
        await settle();
        expect($(el, '.rh-import-grids-error').textContent).toBe(
            'Harbor Items was not imported. Saving a grid needs the Customize Application permission as well as Rowhouse Grid Admin.'
        );
    });

    it('closes on Escape, except while importing', async () => {
        saveDraft.mockResolvedValue('0Af000000000001');
        saveStatus.mockResolvedValue({ status: 'pending' });
        const el = await mount();
        await choose(el, FILE);
        $(el, '.rh-import-grids-confirm').click();
        await settle();
        $(el, 'section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(events).toEqual([]);
        el.remove();
        const other = await mount();
        $(other, 'section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(events).toEqual([{ type: 'cancel', detail: { imported: [] } }]);
    });
});

describe('the list', () => {
    it('says what each kind of grid does', () => {
        expect(describeItem(PLAN[2], FILE_GRIDS[2], 0).className).toContain('rh-import-grids-item_skip');
        expect(describeItem({ ...PLAN[2], existingObjectLabel: 'Accounts' }, FILE_GRIDS[2], 0).text).toBe(
            'This org already has a grid named Consignments, for Accounts: left as it is.'
        );
        expect(importable(PLAN[0])).toBe(true);
        expect(importable(PLAN[2])).toBe(false);
        expect(importable({ ...PLAN[0], errors: ['No.'] })).toBe(false);
    });
});

it('is accessible, on the chooser and with the list', async () => {
    jest.useRealTimers();
    const el = await mount();
    await expect(el).toBeAccessible();
    await choose(el, FILE);
    await expect(el).toBeAccessible();
});
