/**
 * The Display Key's samples for the newer kinds of rule: an icon rule's
 * sample is its icon, and a data bar's sample is a bar drawn part of the way.
 * gridView.displayKey.test.js checks the samples' colors match the table's; this
 * checks what the key draws.
 */
import { createElement } from 'lwc';
import GridView from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import getLayout from '@salesforce/apex/GridController.getLayout';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.getLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveLayout', () => ({ default: jest.fn(() => Promise.resolve(true)) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.resetLayout', () => ({ default: jest.fn(() => Promise.resolve()) }), {
    virtual: true
});

/* global require, __dirname -- Jest runs in Node, where the test reads the stylesheet. */
const fs = require('fs');
const path = require('path');

const rule = (name, label, style, applyTo = 'cell') => ({
    name,
    label,
    field: 'Freight_Charge__c',
    type: 'currency',
    operator: 'greater_than',
    value: '0',
    style,
    applyTo
});
const RULES = [
    rule('Risk', 'At risk', 'icon_warning'),
    rule('Note', 'Has a note', 'icon_info', 'row'),
    rule('Size', 'Charge size', 'data_bar'),
    rule('Big', 'Large shipment', 'fill_green', 'row'),
    rule('Late', 'Overdue', 'text_red')
];
const DEFINITION = {
    name: 'Consignments',
    label: 'Consignments',
    objectApiName: 'Consignment__c',
    objectLabel: 'Consignments',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true },
        {
            field: 'Freight_Charge__c',
            label: 'Freight Charge',
            type: 'currency',
            editable: true,
            sortable: true,
            scale: 2
        }
    ],
    displayRules: RULES
};

const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
// One drawn frame: the key opens after the button's spinner has been drawn
// (gridView.js afterNextPaint). Jest's fake clock fakes frames too.
const paint = () => jest.advanceTimersByTimeAsync(20);

/** The grid with its Display Key open: one entry per rule, in the rules' order. */
async function openKey() {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Consignments';
    document.body.appendChild(el);
    await settle();
    el.shadowRoot.querySelector('.rh-display-key-toggle').click();
    await paint();
    await paint();
    await settle();
    // One query each (HR-21), then matched up by entry.
    const items = [...el.shadowRoot.querySelectorAll('.rh-display-key li')];
    const swatches = [...el.shadowRoot.querySelectorAll('.rh-display-key .rh-display-key-swatch')];
    const icons = [...el.shadowRoot.querySelectorAll('.rh-display-key lightning-icon')];
    return items.map((li, i) => ({
        li,
        swatch: swatches[i],
        classes: swatches[i].className.split(' '),
        icon: icons.find(icon => li.contains(icon)) || null
    }));
}

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, getLayout, fetchRows }));
    jest.useFakeTimers();
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue({ rows: [], hasMore: false, cursorLocator: null, cursorToken: null, totalRows: 0 });
    getLayout.mockResolvedValue(null);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe("the Display Key's samples", () => {
    it("shows an icon rule's icon as its sample, in its color", async () => {
        const [risk, note] = await openKey();
        expect(risk.icon.iconName).toBe('utility:warning');
        expect(risk.icon.variant).toBe('warning');
        expect(risk.icon.size).toBe('xx-small');
        expect(risk.swatch.textContent).toBe('');
        expect(risk.li.textContent).toBe('At risk: Warning icon, Cell');
        // An icon with no color of its own has no variant.
        expect(note.icon.iconName).toBe('utility:info');
        expect(note.icon.variant).toBeFalsy();
        expect(note.li.textContent).toBe('Has a note: Info icon, Row');
    });

    it("shows a data bar's sample as a bar", async () => {
        const size = (await openKey())[2];
        expect(size.classes).toEqual(
            expect.arrayContaining([
                'rh-display-key-swatch',
                'rh-display-key-swatch_cell',
                'rh-rule_databar',
                'rh-display-key-swatch_databar'
            ])
        );
        expect(size.icon).toBeNull();
        expect(size.li.textContent).toBe('AaCharge size: Data bar, Cell');
    });

    it('keeps the color samples as they were', async () => {
        const [, , , big, late] = await openKey();
        expect(big.classes).toEqual(['rh-display-key-swatch', 'rh-display-key-swatch_bar', 'rh-rule_bar-green']);
        expect(late.classes).toEqual(['rh-display-key-swatch', 'rh-display-key-swatch_cell', 'rh-rule_text-red']);
        [big, late].forEach(s => expect(s.icon).toBeNull());
    });

    it('gives no sample an empty, "null" or "undefined" class', async () => {
        const samples = await openKey();
        expect(samples).toHaveLength(RULES.length);
        samples.forEach(({ swatch, classes }) => {
            expect(swatch.className).toBe(swatch.className.trim());
            classes.forEach(c => expect(['', 'null', 'undefined']).not.toContain(c));
        });
    });

    it("draws the data bar sample part of the way: its class sets the bar's length", () => {
        const css = fs
            .readFileSync(path.join(__dirname, '..', 'gridView.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const block = css.match(/\.rh-display-key-swatch_databar\s*\{([^}]*)\}/);
        expect(block).not.toBeNull();
        expect(block[1]).toMatch(/--rh-databar:\s*\d+%/);
    });
});
