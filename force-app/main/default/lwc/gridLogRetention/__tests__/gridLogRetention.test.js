/**
 * The edit log's retention on the Grid Admin tab: what it says for
 * each state, saving a period and waiting for the deploy, and who may save.
 */
import { createElement } from 'lwc';
import GridLogRetention from 'c/gridLogRetention';
import logRetention from '@salesforce/apex/GridAdminController.logRetention';
import saveLogRetention from '@salesforce/apex/GridAdminController.saveLogRetention';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';

jest.mock('@salesforce/apex/GridAdminController.logRetention', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveLogRetention', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });

const OPTIONS = [
    { value: '', label: 'Forever' },
    { value: '90', label: '90 days' },
    { value: '365', label: '1 year' },
    { value: '730', label: '2 years' },
    { value: '2555', label: '7 years' }
];
const FOREVER = {
    days: null,
    label: 'Forever',
    options: OPTIONS,
    canSave: true,
    canRun: true,
    scheduled: false,
    loggingGrids: []
};
const YEAR = {
    days: 365,
    label: '1 year',
    options: OPTIONS,
    canSave: true,
    canRun: true,
    scheduled: true,
    nextRun: '2026-10-07T09:00:00.000Z',
    runsAs: 'Hannah Lowell',
    mine: true,
    loggingGrids: ['Consignment Audit', 'Contact Cleanup'],
    lastCleanup: { when: '2026-10-06T09:00:05.000Z', summary: '12 entries removed' }
};

const settle = async () => {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);

let toasts;
async function mount() {
    const el = createElement('c-grid-log-retention', { is: GridLogRetention });
    toasts = [];
    el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
    document.body.appendChild(el);
    await settle();
    return el;
}
const choose = async (el, value) => {
    $(el, '.rh-retention-choice').dispatchEvent(new CustomEvent('change', { detail: { value } }));
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

it('says entries are kept forever when no period is set', async () => {
    logRetention.mockResolvedValue(FOREVER);
    const el = await mount();
    const box = $(el, '.rh-retention-choice');
    expect(box.label).toBe('Keep entries for');
    expect(box.value).toBe('');
    expect(box.options.map(o => o.label)).toEqual(['Forever', '90 days', '1 year', '2 years', '7 years']);
    expect($(el, '.rh-retention-period .rh-stat-n').textContent).toBe('Forever');
    expect($(el, '.rh-retention-period .rh-stat-l').textContent).toBe(
        'Entries are kept forever. Nothing deletes them.'
    );
    expect($(el, '.rh-retention-next .rh-stat-n').textContent).toBe('Off');
    expect($(el, '.rh-retention-status').textContent).toBe('No clean-up runs while entries are kept forever.');
    expect($(el, '.rh-retention-logging .rh-stat-n').textContent).toBe('0');
    expect($(el, '.rh-retention-logging .rh-stat-l').textContent).toContain(
        "Select Log every change in a grid's settings"
    );
    expect($(el, '.rh-retention-save').disabled).toBe(true);
    expect($(el, '.rh-retention-last')).toBeNull();
    expect($(el, '.rh-retention-warning')).toBeNull();
});

it('says when the clean-up next runs, as whom, and what it last removed', async () => {
    logRetention.mockResolvedValue(YEAR);
    const el = await mount();
    expect($(el, '.rh-retention-choice').value).toBe('365');
    expect($(el, '.rh-retention-period .rh-stat-n').textContent).toBe('1 year');
    expect($(el, '.rh-retention-period .rh-stat-l').textContent).toBe(
        'Entries older than this are deleted each night, for good.'
    );
    expect($(el, '.rh-retention-next .rh-stat-n').textContent).toMatch(/\d/);
    const status = $(el, '.rh-retention-status').textContent;
    expect(status).toMatch(/^The nightly clean-up, next on .+, runs as Hannah Lowell\.$/);
    expect($(el, '.rh-retention-logging .rh-stat-n').textContent).toBe('2');
    expect($(el, '.rh-retention-logging .rh-stat-l').textContent).toBe(
        'grids log every change: Consignment Audit, Contact Cleanup.'
    );
    expect($(el, '.rh-retention-last').textContent).toMatch(/^Last clean-up, .+: 12 entries removed\.$/);
    expect(status).not.toContain('Save to run it as you instead.');
    expect($(el, '.rh-retention-save').disabled).toBe(true);
});

it('offers to run the clean-up as you when it runs as another admin', async () => {
    logRetention.mockResolvedValue({ ...YEAR, runsAs: 'Silas Coffin', mine: false });
    saveLogRetention.mockResolvedValue('0Af000000000004');
    const el = await mount();
    expect($(el, '.rh-retention-status').textContent).toContain('as Silas Coffin.');
    expect($(el, '.rh-retention-status').textContent).toContain('Save to run it as you instead.');
    expect($(el, '.rh-retention-save').disabled).toBe(false);
    $(el, '.rh-retention-save').click();
    await settle();
    expect(saveLogRetention).toHaveBeenCalledWith({ days: 365 });
});

it('warns when a period is set but no clean-up is scheduled', async () => {
    logRetention.mockResolvedValue({ ...YEAR, scheduled: false, lastCleanup: undefined });
    const el = await mount();
    expect($(el, '.rh-retention-next .rh-stat-n').textContent).toBe('Not scheduled');
    expect($(el, '.rh-retention-status').textContent).toBe('The nightly clean-up is not scheduled.');
    expect($(el, '.rh-retention-warning p').textContent).toBe('Save again to start the nightly clean-up.');
    expect($(el, '.rh-retention-save').disabled).toBe(false);
});

it('saves a period, waits for the deploy, and reads the status again', async () => {
    logRetention.mockResolvedValueOnce(FOREVER).mockResolvedValueOnce(YEAR);
    saveLogRetention.mockResolvedValue('0Af000000000001');
    saveStatus
        .mockResolvedValueOnce({ status: 'pending', messages: [] })
        .mockResolvedValueOnce({ status: 'Succeeded', messages: [] });
    const el = await mount();
    await choose(el, '365');
    expect($(el, '.rh-retention-save').disabled).toBe(false);
    $(el, '.rh-retention-save').click();
    await settle();
    expect(saveLogRetention).toHaveBeenCalledWith({ days: 365 });
    const saved = jest.fn();
    el.addEventListener('saved', saved);
    expect($(el, '.rh-retention-saving')).not.toBeNull();
    expect($(el, '.rh-retention-choice').disabled).toBe(true);
    jest.advanceTimersByTime(1000);
    await settle();
    jest.advanceTimersByTime(1500);
    await settle();
    expect(saveStatus).toHaveBeenCalledWith({ jobId: '0Af000000000001' });
    expect(toasts.map(t => t.message)).toEqual(['The edit log keeps its entries for 1 year.']);
    expect(logRetention).toHaveBeenCalledTimes(2);
    expect($(el, '.rh-retention-saving')).toBeNull();
    expect($(el, '.rh-retention-status').textContent).toContain('as Hannah Lowell');
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0][0].detail).toEqual({ days: 365 });
});

it('opens the Grid Guide at How long entries are kept, in a new browser tab', async () => {
    logRetention.mockResolvedValue(FOREVER);
    const el = await mount();
    const link = $(el, '.rh-retention-help');
    expect(link.textContent).toBe('How long entries are kept ↗');
    expect(link.getAttribute('href')).toBe('/lightning/n/Rowhouse_Guide?c__page=features&c__section=audit-retention');
});

it('saves forever as a blank period', async () => {
    logRetention.mockResolvedValueOnce(YEAR).mockResolvedValueOnce(FOREVER);
    saveLogRetention.mockResolvedValue('0Af000000000002');
    saveStatus.mockResolvedValue({ status: 'Succeeded', messages: [] });
    const el = await mount();
    await choose(el, '');
    $(el, '.rh-retention-save').click();
    await settle();
    expect(saveLogRetention).toHaveBeenCalledWith({ days: null });
    jest.advanceTimersByTime(1000);
    await settle();
    expect(toasts.map(t => t.message)).toEqual(['The edit log keeps its entries forever.']);
});

it('shows why a save was refused or failed', async () => {
    logRetention.mockResolvedValue(FOREVER);
    saveLogRetention.mockRejectedValueOnce({
        body: { message: 'The nightly clean-up runs as you, and you cannot delete Grid Edit Log entries.' }
    });
    const el = await mount();
    await choose(el, '90');
    $(el, '.rh-retention-save').click();
    await settle();
    expect($(el, '.rh-retention-save-error').textContent).toContain('cannot delete Grid Edit Log entries');

    saveLogRetention.mockResolvedValueOnce('0Af000000000003');
    saveStatus.mockResolvedValue({
        status: 'Failed',
        messages: ['Rowhouse_Setting__mdt.Default: Log Retention Days: value not of required type']
    });
    $(el, '.rh-retention-save').click();
    await settle();
    jest.advanceTimersByTime(1000);
    await settle();
    expect($(el, '.rh-retention-save-error').textContent).toBe(
        'The save did not go through. Rowhouse_Setting__mdt.Default: Log Retention Days: value not of required type'
    );
});

it('cannot be changed without Customize Application', async () => {
    logRetention.mockResolvedValue({ ...FOREVER, canSave: false });
    const el = await mount();
    expect($(el, '.rh-retention-choice').disabled).toBe(true);
    expect($(el, '.rh-retention-save').disabled).toBe(true);
    expect($(el, '.rh-retention-save').title).toBe('Saving needs the Customize Application permission');
});

it('warns an admin who cannot delete log entries before they save a period', async () => {
    logRetention.mockResolvedValue({ ...FOREVER, canRun: false });
    const el = await mount();
    expect($(el, '.rh-retention-warning')).toBeNull();
    await choose(el, '90');
    expect($(el, '.rh-retention-warning').textContent).toContain('Ask a System Administrator to save it.');
});

it('says what went wrong when the status cannot be read', async () => {
    logRetention.mockRejectedValue({ body: { message: 'This needs the Rowhouse Grid Admin permission set.' } });
    const el = await mount();
    expect($(el, '.rh-retention-error').textContent).toBe('This needs the Rowhouse Grid Admin permission set.');
    expect($(el, '.rh-retention-choice')).toBeNull();
});

it('is accessible', async () => {
    logRetention.mockResolvedValue(YEAR);
    const el = await mount();
    jest.useRealTimers();
    await expect(el).toBeAccessible();
});
