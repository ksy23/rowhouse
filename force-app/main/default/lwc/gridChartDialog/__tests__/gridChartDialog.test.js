/**
 * Edit chart, as drawn in the mock-up: Chart type as three tiles; Measure
 * (Record count, Sum of, Average of) beside Field; Group by, a date by
 * month, quarter or year; and what it saves.
 */
import { createElement } from 'lwc';
import GridChartDialog from 'c/gridChartDialog';

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', groupable: false },
    { field: 'Service_Level__c', label: 'Service Level', type: 'picklist', groupable: true },
    { field: 'Ship_Date__c', label: 'Ship Date', type: 'date', groupable: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', groupable: false }
];
const CHART = { type: 'hbar', measure: 'count', field: null, groupBy: 'Service_Level__c', unit: null };

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const choose = async (selector, value) => {
    $(selector).dispatchEvent(new CustomEvent('change', { detail: { value } }));
    await flush();
};
const pickType = async value => {
    const input = $$('.rh-chart-type-input').find(i => i.value === value);
    input.checked = true;
    input.dispatchEvent(new CustomEvent('change'));
    await flush();
};

async function mount(props = {}) {
    el = createElement('c-grid-chart-dialog', { is: GridChartDialog });
    Object.assign(el, { chart: CHART, columns: COLUMNS, ...props });
    events = [];
    el.addEventListener('save', e => events.push({ name: 'save', detail: e.detail }));
    el.addEventListener('cancel', () => events.push({ name: 'cancel' }));
    document.body.appendChild(el);
    await flush();
}

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

it('is laid out as the mock-up: tiles, then Measure beside Field, then Group by and its help', async () => {
    await mount();
    expect($('h1').textContent).toBe('Edit chart');
    expect($('legend').textContent).toBe('Chart type');
    expect($$('.rh-chart-type-label').map(l => l.textContent)).toEqual(['Vertical bar', 'Horizontal bar', 'Donut']);
    expect($$('.rh-chart-type-tile').map(t => t.classList.contains('rh-chart-type-tile_on'))).toEqual([
        false,
        true,
        false
    ]);
    expect($$('.rh-chart-pair lightning-combobox').map(c => c.label)).toEqual(['Measure', 'Field']);
    expect($('.rh-chart-measure').options.map(o => o.label)).toEqual(['Record count', 'Sum of', 'Average of']);
    expect($('.rh-chart-measure').value).toBe('count');
    expect($('.rh-chart-group').label).toBe('Group by');
    expect($('.rh-chart-help').textContent).toBe(
        "Measure: Record count, or the Sum or Average of a number, currency or percent column, as a list view's chart offers. Group by: any column the grid can group by; dates by month, quarter or year."
    );
});

it('starts on the chosen chart type, and draws each with its own picture', async () => {
    await mount({ chart: { ...CHART, type: 'donut' } });
    expect(el.shadowRoot.activeElement).toBe($$('.rh-chart-type-input')[2]);
    expect($$('.rh-chart-type-input').map(i => i.checked)).toEqual([false, false, true]);
    expect($$('.rh-chart-type-figure').map(s => s.getElementsByTagName('rect').length)).toEqual([3, 3, 0]);
    expect($$('.rh-chart-type-figure')[2].querySelectorAll('circle')).toHaveLength(3);
});

it('waits on Field until a sum or an average needs one, choosing the only one there is', async () => {
    await mount();
    expect($('.rh-chart-field').disabled).toBe(true);
    expect($('.rh-chart-field').required).toBe(false);
    expect($('.rh-chart-field').placeholder).toBe('Not used for Record count');
    await choose('.rh-chart-measure', 'sum');
    expect($('.rh-chart-field').disabled).toBe(false);
    expect($('.rh-chart-field').required).toBe(true);
    expect($('.rh-chart-field').options).toEqual([{ value: 'Freight_Charge__c', label: 'Freight Charge' }]);
    expect($('.rh-chart-field').value).toBe('Freight_Charge__c');
    expect($('.rh-chart-save').disabled).toBe(false);
});

it('offers Record count only where there is no number column', async () => {
    await mount({ columns: COLUMNS.filter(c => c.type !== 'currency') });
    expect($('.rh-chart-measure').options.map(o => o.label)).toEqual(['Record count']);
});

it('offers a date by month, quarter or year in Group by', async () => {
    await mount();
    expect($('.rh-chart-group').options.map(o => o.label)).toEqual([
        'Service Level',
        'Ship Date (Month)',
        'Ship Date (Quarter)',
        'Ship Date (Year)'
    ]);
    await choose('.rh-chart-group', 'Ship_Date__c:quarter');
    await pickType('vbar');
    expect($$('.rh-chart-type-tile')[0].classList.contains('rh-chart-type-tile_on')).toBe(true);
    $('.rh-chart-save').click();
    expect(events).toEqual([
        {
            name: 'save',
            detail: {
                chart: { type: 'vbar', measure: 'count', field: null, groupBy: 'Ship_Date__c', unit: 'quarter' }
            }
        }
    ]);
});

it('keeps a chart by another period as it is', async () => {
    await mount({ chart: { ...CHART, groupBy: 'Ship_Date__c', unit: 'week' } });
    expect($('.rh-chart-group').value).toBe('Ship_Date__c:week');
    expect($('.rh-chart-group').options.map(o => o.label)).toContain('Ship Date (Week)');
});

it('saves an average of the field chosen, as a donut', async () => {
    await mount();
    await pickType('donut');
    await choose('.rh-chart-measure', 'average');
    $('.rh-chart-save').click();
    expect(events[0].detail.chart).toEqual({
        type: 'donut',
        measure: 'average',
        field: 'Freight_Charge__c',
        groupBy: 'Service_Level__c',
        unit: null
    });
});

it('cancels from Cancel, the close button and Escape', async () => {
    await mount();
    $('.rh-chart-cancel').click();
    $('.rh-chart-close').click();
    $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events).toEqual([{ name: 'cancel' }, { name: 'cancel' }, { name: 'cancel' }]);
});

it('is accessible', async () => {
    await mount();
    await expect(el).toBeAccessible();
});
