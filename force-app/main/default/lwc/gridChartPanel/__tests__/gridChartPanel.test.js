/**
 * The Charts panel: its heading and close button, the chart's title and gear
 * (Display As, Edit Chart), the chart drawn as bars or a donut, the donut's
 * list of groups, a table of the figures for screen readers, and what it says
 * while loading, on an error, with too many groups or none.
 */
import { createElement } from 'lwc';
import GridChartPanel from 'c/gridChartPanel';

const COLUMNS = [
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        groupable: true,
        options: [
            { value: 'Economy', label: 'Economy' },
            { value: 'Standard', label: 'Standard' },
            { value: 'Express', label: 'Express' }
        ]
    },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', scale: 2, groupable: false }
];
const CHART = { type: 'hbar', measure: 'count', field: null, groupBy: 'Service_Level__c', unit: null };
const GROUPS = [
    { k: ['Economy'], l: [''], n: 3, v: {} },
    { k: ['Standard'], l: [''], n: 5, v: {} },
    { k: ['Express'], l: [''], n: 1, v: {} }
];

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];

async function mount(props = {}) {
    el = createElement('c-grid-chart-panel', { is: GridChartPanel });
    Object.assign(el, { chart: CHART, columns: COLUMNS, data: { status: 'ready', groups: GROUPS }, ...props });
    events = [];
    ['close', 'type', 'edit'].forEach(name => el.addEventListener(name, e => events.push({ name, detail: e.detail })));
    document.body.appendChild(el);
    await flush();
}

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

it("is headed Charts, as a list view's panel, and names the chart", async () => {
    await mount();
    expect($('.rh-charts-heading').textContent).toBe('Charts');
    expect($('.rh-charts-close').alternativeText).toBe('Close charts');
    expect($('.rh-charts-title').textContent).toBe('Record Count by Service Level');
});

it('draws horizontal bars, largest first, each with its group and figure', async () => {
    await mount();
    expect($$('svg rect')).toHaveLength(3);
    expect($$('.rh-charts-label').map(t => t.textContent)).toEqual(['Standard', 'Economy', 'Express']);
    expect($$('.rh-charts-value').map(t => t.textContent)).toEqual(['5', '3', '1']);
    expect($('.rh-charts-legend')).toBeNull();
    expect($('.rh-charts-foot').textContent).toBe('All 9 records the search and filters match, as saved.');
});

it('draws vertical bars', async () => {
    await mount({ chart: { ...CHART, type: 'vbar' } });
    expect($$('svg rect')).toHaveLength(3);
    expect($('.rh-charts-label').getAttribute('transform')).toMatch(/^rotate\(-40 /);
});

it('draws a donut with its total in the middle, and lists the groups under it', async () => {
    await mount({ chart: { ...CHART, type: 'donut' } });
    expect($$('svg circle')).toHaveLength(3);
    expect($('.rh-charts-total').textContent).toBe('9');
    expect($$('.rh-charts-legend-item').map(li => li.textContent)).toEqual(['Standard5', 'Economy3', 'Express1']);
});

it('gives screen readers a table of the figures, with the total', async () => {
    await mount();
    expect($('svg').getAttribute('aria-hidden')).toBe('true');
    const table = $('.rh-charts-table');
    expect(table.querySelector('caption').textContent).toBe('Record Count by Service Level');
    expect([...table.querySelectorAll('tbody tr')].map(tr => tr.textContent)).toEqual([
        'Standard5',
        'Economy3',
        'Express1',
        'Total9'
    ]);
});

it('offers Display As and Edit Chart in its gear, and says which type is drawn', async () => {
    await mount();
    const items = $$('.rh-charts-menu lightning-menu-item');
    expect(items.map(i => [i.label, i.checked === true])).toEqual([
        ['Vertical Bar Chart', false],
        ['Horizontal Bar Chart', true],
        ['Donut Chart', false],
        ['Edit Chart', false]
    ]);
    expect($('.rh-charts-menu lightning-menu-subheader').label).toBe('Display As');
    const menu = $('.rh-charts-menu');
    menu.dispatchEvent(new CustomEvent('select', { detail: { value: 'donut' } }));
    menu.dispatchEvent(new CustomEvent('select', { detail: { value: 'edit' } }));
    $('.rh-charts-close').click();
    expect(events).toEqual([
        { name: 'type', detail: { type: 'donut' } },
        { name: 'edit', detail: null },
        { name: 'close', detail: null }
    ]);
});

it('shows a spinner while the figures load', async () => {
    await mount({ data: { status: 'loading' } });
    expect($('lightning-spinner')).not.toBeNull();
    expect($('svg')).toBeNull();
});

it('says why there is no chart', async () => {
    await mount({ data: { status: 'error', message: 'Insufficient access.' } });
    expect($('.rh-charts-message').textContent).toBe('The chart could not be drawn. Insufficient access.');
    el.data = { status: 'tooMany' };
    await flush();
    expect($('.rh-charts-message').textContent).toBe(
        'There are too many groups to chart. Group by another column, or a date by a longer period.'
    );
    el.data = { status: 'ready', groups: [] };
    await flush();
    expect($('.rh-charts-message').textContent).toBe('There are no records to chart.');
    expect($('svg')).toBeNull();
});

it('is accessible', async () => {
    await mount({ chart: { ...CHART, type: 'donut' } });
    await expect(el).toBeAccessible();
});
