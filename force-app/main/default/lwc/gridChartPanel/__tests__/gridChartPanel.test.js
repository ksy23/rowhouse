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
    ['close', 'edit', 'display'].forEach(name =>
        el.addEventListener(name, e => events.push({ name, detail: e.detail }))
    );
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
    expect($('.rh-charts-edit').alternativeText).toBe('Chart options');
    expect($('.rh-charts-close').alternativeText).toBe('Close the chart');
    $('.rh-charts-edit').dispatchEvent(new CustomEvent('select', { detail: { value: 'edit' } }));
    $('.rh-charts-close').click();
    expect(events).toEqual([
        { name: 'edit', detail: null },
        { name: 'close', detail: null }
    ]);
});

it("offers Display as in the gear's menu, the type drawn checked, then Edit chart", async () => {
    await mount();
    expect($('lightning-menu-subheader').label).toBe('Display as');
    const items = $$('.rh-charts-edit lightning-menu-item');
    expect(items.map(i => i.label)).toEqual([
        'Vertical bar',
        'Horizontal bar',
        'Stacked vertical bar',
        'Stacked horizontal bar',
        'Donut',
        'Edit chart'
    ]);
    expect(items.map(i => i.checked)).toEqual([false, true, false, false, false, undefined]);
    $('.rh-charts-edit').dispatchEvent(new CustomEvent('select', { detail: { value: 'donut' } }));
    // The type already drawn is no change.
    $('.rh-charts-edit').dispatchEvent(new CustomEvent('select', { detail: { value: 'hbar' } }));
    $('.rh-charts-edit').dispatchEvent(new CustomEvent('select', { detail: { value: 'svbar' } }));
    expect(events).toEqual([
        { name: 'display', detail: { type: 'donut' } },
        { name: 'display', detail: { type: 'svbar' } }
    ]);
});

it('says what a bar is, its figure and its share, as the pointer moves over it', async () => {
    await mount();
    const rect = $$('svg rect')[0];
    rect.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 90 }));
    await flush();
    expect($$('.rh-charts-tip div').map(d => d.textContent)).toEqual([
        'Service Level: Standard',
        'Record Count: 5',
        '55.6% of 9'
    ]);
    $('svg').dispatchEvent(new CustomEvent('mouseleave'));
    await flush();
    expect($('.rh-charts-tip')).toBeNull();
});

it('keeps the tooltip inside the plot, slid along the pointer as far as the pointer is across it', async () => {
    await mount();
    $('.rh-charts-plot').getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 400 });
    const rect = $$('svg rect')[0];
    rect.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 90 }));
    await flush();
    const style = $('.rh-charts-tip').getAttribute('style');
    expect(style).toContain('left: 150px');
    expect(style).toContain('translate(-75%, calc(-100% - 10px))');
    // Near the top, below the pointer.
    rect.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 20 }));
    await flush();
    expect($('.rh-charts-tip').getAttribute('style')).toContain('translate(-0%, 16px)');
});

it('stacks a second column within each bar, with a key to its colours and a tooltip for each stack', async () => {
    const columns = COLUMNS.concat([
        {
            field: 'Mode__c',
            label: 'Mode',
            type: 'picklist',
            groupable: true,
            options: [
                { value: 'Road', label: 'Road' },
                { value: 'Rail', label: 'Rail' }
            ]
        }
    ]);
    const groups = [
        { k: ['Economy', 'Road'], l: ['', ''], n: 2, v: {} },
        { k: ['Economy', 'Rail'], l: ['', ''], n: 1, v: {} },
        { k: ['Standard', 'Road'], l: ['', ''], n: 4, v: {} }
    ];
    await mount({
        chart: { ...CHART, type: 'shbar', stackBy: 'Mode__c', stackUnit: null },
        columns,
        data: { status: 'ready', groups }
    });
    expect($('h2').textContent).toBe('Record Count by Service Level and Mode');
    expect($('.rh-charts-sub').textContent).toBe('Stacked horizontal bar · kept for you');
    expect($$('.rh-charts-stackkey-item').map(li => li.textContent)).toEqual(['Road', 'Rail']);
    const rects = $$('svg rect');
    // Standard: Road; Economy: Road and Rail.
    expect(rects.map(r => r.getAttribute('class'))).toEqual(['rh-chart-c0', 'rh-chart-c0', 'rh-chart-c1']);
    rects[2].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 90 }));
    await flush();
    expect($$('.rh-charts-tip div').map(d => d.textContent)).toEqual([
        'Service Level: Economy',
        'Mode: Rail',
        'Record Count: 1',
        '14.3% of 7'
    ]);
    $('.rh-charts-toggle').click();
    await flush();
    expect([...$('.rh-charts-grid').querySelectorAll('tbody tr')].map(tr => tr.textContent)).toEqual([
        'Standard457.1%',
        'Road457.1%',
        'Economy342.9%',
        'Road228.6%',
        'Rail114.3%',
        'Total7'
    ]);
    expect($('.rh-charts-foot').textContent).toContain('Up to 7 stacks in each; the rest go in Other.');
});

it('says which periods a date stacks by', async () => {
    const columns = COLUMNS.concat([{ field: 'Ship_Date__c', label: 'Ship Date', type: 'date', groupable: true }]);
    await mount({
        chart: { ...CHART, type: 'svbar', stackBy: 'Ship_Date__c', stackUnit: 'quarter' },
        columns,
        data: { status: 'ready', groups: [{ k: ['Economy', '2026-Q1'], l: ['', ''], n: 2, v: {} }] }
    });
    expect($('.rh-charts-foot').textContent).toContain('Stacks: the last 6 quarters; the ones before go in Earlier.');
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

it('lets a name in the table wrap after a slash, not mid-word', async () => {
    const columns = [
        {
            ...COLUMNS[0],
            options: [
                { value: 'Economy', label: 'Economy' },
                { value: 'Standard', label: 'Negotiation/Review' },
                { value: 'Express', label: 'Express' }
            ]
        },
        COLUMNS[1]
    ];
    await mount({ columns });
    $('.rh-charts-toggle').click();
    await flush();
    expect($('.rh-charts-grid th[scope="row"]').textContent).toBe('Negotiation/​Review');
});

it('shows the figures as a table, and the chart again', async () => {
    await mount();
    $('.rh-charts-toggle').click();
    await flush();
    expect($('svg')).toBeNull();
    const table = $('.rh-charts-grid');
    expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).toEqual([
        'Service Level',
        'Records',
        'Share'
    ]);
    // The groups' names may wrap; the figures keep to one line.
    expect(
        [...table.querySelectorAll('th[scope="row"]')].every(th => th.classList.contains('rh-charts-grid-label'))
    ).toBe(true);
    expect([...table.querySelectorAll('tbody tr')].map(tr => tr.textContent)).toEqual([
        'Standard555.6%',
        'Economy333.3%',
        'Express111.1%',
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
    // Hidden by a wrapper: a table ignores the 1px width, so on the table
    // itself the hidden class would still widen the panel.
    expect(table.classList.contains('slds-assistive-text')).toBe(false);
    expect(table.parentElement.classList.contains('slds-assistive-text')).toBe(true);
    expect(table.querySelector('caption').textContent).toBe('Record Count by Service Level');
    // Each figure with its share of the total, as the tooltip gives it.
    expect([...table.querySelectorAll('tbody tr')].map(tr => tr.textContent)).toEqual([
        'Standard555.6%',
        'Economy333.3%',
        'Express111.1%',
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
