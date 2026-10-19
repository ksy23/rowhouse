/**
 * Export, as Salesforce's dialog for a report: Export View as two cards
 * (Formatted Report, Details Only), Format, and Encoding for a CSV; how many
 * rows the export holds; progress while the rest load; what it sends.
 */
import { createElement } from 'lwc';
import GridExportDialog from 'c/gridExportDialog';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const pickView = async value => {
    const input = $$('.rh-export-view-input').find(i => i.value === value);
    input.checked = true;
    input.dispatchEvent(new CustomEvent('change'));
    await flush();
};

async function mount(props = {}) {
    el = createElement('c-grid-export-dialog', { is: GridExportDialog });
    Object.assign(el, { total: 31, loaded: 31, max: 100000, ...props });
    events = [];
    el.addEventListener('export', e => events.push({ name: 'export', detail: e.detail }));
    el.addEventListener('cancel', () => events.push({ name: 'cancel' }));
    document.body.appendChild(el);
    await flush();
}

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

it('offers the two views as Salesforce does, Formatted Report chosen, in an Excel workbook only', async () => {
    await mount();
    expect($('h1').textContent).toBe('Export');
    expect($('legend').textContent).toBe('Export View');
    expect($$('.rh-export-view-title').map(t => t.textContent)).toEqual(['Formatted Report', 'Details Only']);
    expect($$('.rh-export-view-text').map(t => t.textContent)).toEqual([
        'Export the report, including the report header, groupings, and filter settings.',
        'Export only the detail rows. Use this to do further calculations or for uploading to other systems.'
    ]);
    expect($$('.rh-export-view-tile').map(t => t.classList.contains('rh-export-view-tile_on'))).toEqual([true, false]);
    expect($('.rh-export-format').label).toBe('Format');
    expect($('.rh-export-format').value).toBe('xlsx');
    expect($('.rh-export-format').options.map(o => o.label)).toEqual(['Excel Format .xlsx']);
    expect($('.rh-export-format').disabled).toBe(true);
    expect($('.rh-export-encoding')).toBeNull();
    // Focus starts on the chosen view.
    expect(el.shadowRoot.activeElement).toBe($$('.rh-export-view-input')[0]);
    $('.rh-export-go').click();
    expect(events).toEqual([{ name: 'export', detail: { view: 'formatted', format: 'xlsx' } }]);
});

it('offers Details Only as an Excel workbook or a CSV, the CSV in UTF-8', async () => {
    await mount();
    await pickView('details');
    expect($('.rh-export-format').disabled).toBe(false);
    expect($('.rh-export-format').options.map(o => o.label)).toEqual(['Excel Format .xlsx', 'Comma Delimited .csv']);
    $('.rh-export-go').click();
    $('.rh-export-format').dispatchEvent(new CustomEvent('change', { detail: { value: 'csv' } }));
    await flush();
    expect($('.rh-export-encoding').label).toBe('Encoding');
    expect($('.rh-export-encoding').options.map(o => o.label)).toEqual(['Unicode (UTF-8)']);
    expect($('.rh-export-encoding').disabled).toBe(true);
    $('.rh-export-go').click();
    // Back to Formatted Report: an Excel workbook again.
    await pickView('formatted');
    $('.rh-export-go').click();
    expect(events.map(e => e.detail)).toEqual([
        { view: 'details', format: 'xlsx' },
        { view: 'details', format: 'csv' },
        { view: 'formatted', format: 'xlsx' }
    ]);
});

it('says when the rows not yet loaded load first, and when an export holds fewer than match', async () => {
    await mount();
    expect($('.rh-export-note')).toBeNull();
    el.total = 14000;
    el.loaded = 10000;
    await flush();
    expect($('.rh-export-note').textContent).toBe(
        'All 14,000 records are exported. The 4,000 not yet loaded load first.'
    );
    el.total = 125000;
    await flush();
    expect($('.rh-export-note').textContent).toBe('125,000 records match. An export holds the first 100,000.');
});

it('shows how far the rows have loaded while it is busy, and waits', async () => {
    await mount({ total: 14000, loaded: 12000, busy: true });
    expect($('.rh-export-progress p').textContent).toBe('Loading rows… 12,000 of 14,000');
    expect($('.slds-progress-bar').getAttribute('aria-valuenow')).toBe('86');
    expect($('.rh-export-go').disabled).toBe(true);
    expect($('.rh-export-format').disabled).toBe(true);
    $('.rh-export-go').click();
    expect(events).toEqual([]);
    el.loaded = 14000;
    await flush();
    expect($('.rh-export-progress p').textContent).toBe('Writing the file…');
});

it('shows what went wrong', async () => {
    await mount({ error: 'This browser did not allow the file to be downloaded.' });
    expect($('.rh-export-error').textContent).toBe('This browser did not allow the file to be downloaded.');
    expect($('.rh-export-error').getAttribute('role')).toBe('alert');
});

it('cancels from Cancel, the close button and Escape', async () => {
    await mount();
    $('.rh-export-cancel').click();
    $('.rh-export-close').click();
    $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events.map(e => e.name)).toEqual(['cancel', 'cancel', 'cancel']);
});

it('keeps focus inside: round from the last control to the first, and back', async () => {
    await mount();
    $('[data-guard="end"]').dispatchEvent(new CustomEvent('focus'));
    expect(el.shadowRoot.activeElement).toBe($('.rh-export-close'));
    $('[data-guard="start"]').dispatchEvent(new CustomEvent('focus'));
    expect(el.shadowRoot.activeElement).toBe($('.rh-export-go'));
});

it('is accessible', async () => {
    await mount({ total: 14000, loaded: 10000 });
    await expect(el).toBeAccessible();
});
