/**
 * Edit Chart: a list view's fields (Chart Type, Aggregate Type, Aggregate
 * Field, Grouping Field), Group Dates By for a date, and what it saves.
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
const choose = async (selector, value) => {
    $(selector).dispatchEvent(new CustomEvent('change', { detail: { value } }));
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

it("asks in a list view's words, starting from the chart as it is", async () => {
    await mount();
    expect($('h1').textContent).toBe('Edit Chart');
    expect($('.rh-chart-type').label).toBe('Chart Type');
    expect($('.rh-chart-type').options.map(o => o.label)).toEqual([
        'Vertical Bar Chart',
        'Horizontal Bar Chart',
        'Donut Chart'
    ]);
    expect($('.rh-chart-type').value).toBe('hbar');
    expect($('.rh-chart-measure').label).toBe('Aggregate Type');
    expect($('.rh-chart-measure').options.map(o => o.label)).toEqual(['Average', 'Sum', 'Count']);
    expect($('.rh-chart-group').label).toBe('Grouping Field');
    expect($('.rh-chart-group').options.map(o => o.label)).toEqual(['Service Level', 'Ship Date']);
    expect($('.rh-chart-field')).toBeNull(); // Count counts the records: no field
});

it('asks for the field to add up for Sum or Average, choosing the only one there is', async () => {
    await mount();
    await choose('.rh-chart-measure', 'sum');
    expect($('.rh-chart-field').label).toBe('Aggregate Field');
    expect($('.rh-chart-field').options).toEqual([{ value: 'Freight_Charge__c', label: 'Freight Charge' }]);
    expect($('.rh-chart-field').value).toBe('Freight_Charge__c');
    expect($('.rh-chart-save').disabled).toBe(false);
});

it('offers Count only where there is no number column', async () => {
    await mount({ columns: COLUMNS.filter(c => c.type !== 'currency') });
    expect($('.rh-chart-measure').options.map(o => o.label)).toEqual(['Count']);
});

it('asks how to group dates, by month unless chosen', async () => {
    await mount();
    expect($('.rh-chart-unit')).toBeNull();
    await choose('.rh-chart-group', 'Ship_Date__c');
    expect($('.rh-chart-unit').label).toBe('Group Dates By');
    expect($('.rh-chart-unit').value).toBe('month');
    await choose('.rh-chart-unit', 'quarter');
    await choose('.rh-chart-type', 'vbar');
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

it('saves an average of the field chosen, as a donut', async () => {
    await mount();
    await choose('.rh-chart-type', 'donut');
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
