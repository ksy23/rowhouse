/**
 * The chart panel, as drawn in the mock-up: the chart's title and how it is
 * drawn, the gear (Edit chart) and close; bars, or a donut with its total and
 * count in the middle and its groups beside it; a table of the figures for
 * screen readers; the foot with what it covers and Show as a table; and what
 * it says while loading, on an error, with too many groups or none.
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
    Object.assign(el, {
        chart: CHART,
        columns: COLUMNS,
        data: { status: 'ready', groups: GROUPS },
        objectLabel: 'Consignments',
        ...props
    });
    events = [];
    ['close', 'edit'].forEach(name => el.addEventListener(name, e => events.push({ name, detail: e.detail })));
    document.body.appendChild(el);
    await flush();
}

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

it('is headed by the chart: its title, how it is drawn, the gear and close', async () => {
    await mount({ chart: { ...CHART, type: 'donut' } });
    expect($('h2').textContent).toBe('Record Count by Service Level');
    expect($('.rh-charts-sub').textContent).toBe('Donut · kept for you');
    expect($('.rh-charts-edit').alternativeText).toBe('Edit chart');
    expect($('.rh-charts-close').alternativeText).toBe('Close the chart');
    $('.rh-charts-edit').click();
    $('.rh-charts-close').click();
    expect(events).toEqual([
        { name: 'edit', detail: null },
        { name: 'close', detail: null }
    ]);
});

it('draws horizontal bars, largest first, each with its group and figure, in the bars colour', async () => {
    await mount();
    expect($('.rh-charts-sub').textContent).toBe('Horizontal bar · kept for you');
    expect($$('svg rect')).toHaveLength(3);
    expect($$('svg rect').map(r => r.getAttribute('class'))).toEqual(['rh-chart-bar', 'rh-chart-bar', 'rh-chart-bar']);
    expect($$('.rh-charts-label').map(t => t.textContent)).toEqual(['Standard', 'Economy', 'Express']);
    expect($$('.rh-charts-value').map(t => t.textContent)).toEqual(['5', '3', '1']);
    expect($('.rh-charts-legend')).toBeNull();
});

it('draws vertical bars', async () => {
    await mount({ chart: { ...CHART, type: 'vbar' } });
    expect($('.rh-charts-sub').textContent).toBe('Vertical bar · kept for you');
    expect($$('svg rect')).toHaveLength(3);
    expect($('.rh-charts-label').getAttribute('transform')).toMatch(/^rotate\(-40 /);
});

it('draws a donut with its total and count in the middle, and its groups beside it', async () => {
    await mount({ chart: { ...CHART, type: 'donut' } });
    expect($$('svg circle')).toHaveLength(3);
    expect($('.rh-charts-total').textContent).toBe('9');
    expect($('.rh-charts-count').textContent).toBe('9 consignments');
    expect($$('.rh-charts-legend-item').map(li => li.textContent)).toEqual(['Standard5', 'Economy3', 'Express1']);
    el.objectLabel = 'Consignment Line Items';
    await flush();
    expect($('.rh-charts-count').textContent).toBe('9 records');
});

it('shows an amount with its currency in the middle and beside the donut', async () => {
    await mount({
        chart: { ...CHART, type: 'donut', measure: 'sum', field: 'Freight_Charge__c' },
        data: {
            status: 'ready',
            groups: [
                { k: ['Economy'], l: [''], n: 3, v: { Freight_Charge__c: { s: '1140000', c: 3 } } },
                { k: ['Standard'], l: [''], n: 5, v: { Freight_Charge__c: { s: '980000', c: 5 } } }
            ]
        }
    });
    expect($('.rh-charts-total').textContent).toMatch(/^\D*2\.1M$/);
    expect($('.rh-charts-total').getAttribute('style')).toMatch(/font-size: 18px/);
    expect($('.rh-charts-legend-value').textContent).toMatch(/^\D*1\.1M$/);
});

it('sets a total with a currency code smaller, to fit inside the ring', async () => {
    await mount({
        chart: { ...CHART, type: 'donut', measure: 'sum', field: 'Freight_Charge__c' },
        columns: [COLUMNS[0], { ...COLUMNS[1], currencyField: 'CurrencyIsoCode', totalCurrency: 'GBP' }],
        data: {
            status: 'ready',
            groups: [
                { k: ['Economy'], l: [''], n: 3, v: { Freight_Charge__c: { s: '61208.14', c: 3 } } },
                { k: ['Standard'], l: [''], n: 5, v: { Freight_Charge__c: { s: '44000', c: 5 } } }
            ]
        }
    });
    expect($('.rh-charts-total').textContent).toMatch(/GBP/);
    expect($('.rh-charts-total').getAttribute('style')).toMatch(/font-size: 1[0-7]px/);
});

it('says what it covers at its foot', async () => {
    await mount({ chart: { ...CHART, type: 'donut' } });
    expect($('.rh-charts-foot').textContent).toBe(
        'All 9 consignments the search and filters match, as saved. Up to 10 slices; the rest go in Other. Show as a table'
    );
    el.objectLabel = 'SLA Records';
    el.chart = { ...CHART };
    await flush();
    expect($('.rh-charts-foot').textContent).toMatch(/^All 9 SLA records .* Up to 10 bars; the rest go in Other\./);
});

it("names a date chart's periods at its foot", async () => {
    await mount({
        chart: { ...CHART, groupBy: 'Ship_Date__c', unit: 'quarter' },
        columns: [...COLUMNS, { field: 'Ship_Date__c', label: 'Ship Date', type: 'date', groupable: true }],
        data: { status: 'ready', groups: [{ k: ['2026-07-01'], l: [''], n: 4, v: {} }] }
    });
    expect($('.rh-charts-foot').textContent).toContain('The last 24 quarters; the ones before go in Earlier.');
});

it('shows the figures as a table, and the chart again', async () => {
    await mount();
    $('.rh-charts-toggle').click();
    await flush();
    expect($('svg')).toBeNull();
    const table = $('.rh-charts-grid');
    expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['Service Level', 'Records']);
    // The groups' names may wrap; the figures keep to one line.
    expect(
        [...table.querySelectorAll('th[scope="row"]')].every(th => th.classList.contains('rh-charts-grid-label'))
    ).toBe(true);
    expect([...table.querySelectorAll('tbody tr')].map(tr => tr.textContent)).toEqual([
        'Standard5',
        'Economy3',
        'Express1',
        'Total9'
    ]);
    expect($('.rh-charts-toggle').textContent).toBe('Show as a chart');
    $('.rh-charts-toggle').click();
    await flush();
    expect($('svg')).not.toBeNull();
    expect($('.rh-charts-grid')).toBeNull();
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
    expect($('.rh-charts-foot')).toBeNull();
});

it('is accessible', async () => {
    await mount({ chart: { ...CHART, type: 'donut' } });
    await expect(el).toBeAccessible();
});
