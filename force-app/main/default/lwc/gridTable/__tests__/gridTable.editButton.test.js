/**
 * The edit pencil shows only on hover or focus, in Salesforce's data-table blue;
 * so does a read-only cell's light grey lock, and the column's header
 * carries one lock for all its cells. Jest has no layout or hover, so the stylesheet's rules
 * are checked as written, and the markup is checked for the one thing those
 * rules rely on: the edit button is the only button directly inside a cell's
 * content. The look itself was checked in Lightning Experience.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';
import { seedRows, columns } from '../../../../../../test-data/tests/jest/fixtures/seed';

/* global require, __dirname -- Jest runs in Node, where the test reads the stylesheet. */
const fs = require('fs');
const path = require('path');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** [{ selectors: [...], opacity }] in source order, comments removed. */
function opacityRules() {
    const css = fs.readFileSync(path.join(__dirname, '..', 'gridTable.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        const opacity = /opacity:\s*([\d.]+)/.exec(m[2]);
        if (opacity) {
            rules.push({
                selectors: m[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')),
                opacity: Number(opacity[1])
            });
        }
    }
    return rules;
}

const indexOf = (rules, selector) => rules.findIndex(r => r.selectors.includes(selector));

describe('edit pencil on hover, light grey lock', () => {
    const rules = opacityRules();

    it('hides the pencil by default', () => {
        const i = indexOf(rules, '.rh-cell-content > button');
        expect(i).toBeGreaterThanOrEqual(0);
        expect(rules[i].opacity).toBe(0);
    });

    it('shows it on the hovered cell and on the focused cell', () => {
        const hover = indexOf(rules, '.rh-cell:hover .rh-cell-content > button');
        const focus = indexOf(rules, '.rh-cell:focus-within .rh-cell-content > button');
        expect(hover).toBeGreaterThan(indexOf(rules, '.rh-cell-content > button'));
        expect(rules[hover].opacity).toBe(1);
        expect(rules[focus].opacity).toBe(1);
    });

    it('shows the lock only on hover or focus, at half strength (revisits)', () => {
        // A column of locks on every row was noise: the header's lock says it once.
        const hidden = indexOf(rules, '.rh-cell .rh-cell-content > button:disabled');
        expect(rules[hidden].opacity).toBe(0);
        const hover = indexOf(rules, '.rh-cell:hover .rh-cell-content > button:disabled');
        const focus = indexOf(rules, '.rh-cell:focus-within .rh-cell-content > button:disabled');
        expect(rules[hover].opacity).toBe(0.5);
        expect(rules[focus].opacity).toBe(0.5);
        // After the pencil's hover rule, so hovering cannot darken it to full strength.
        expect(hover).toBeGreaterThan(indexOf(rules, '.rh-cell:hover .rh-cell-content > button'));
    });

    it('says a column is read-only in its spoken name, with no lock in its header, as a list view does', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        el.config = { columns, rows: seedRows.slice(0, 2) };
        document.body.appendChild(el);
        await flush();
        const th = field => el.shadowRoot.querySelector(`th[data-field="${field}"]`);
        expect(th('Pro_Number__c').getAttribute('aria-label')).toBe('PRO Number, read only');
        expect(th('Consignee__c').getAttribute('aria-label')).toBe('Consignee'); // editable: no "read only"
        // The lock is drawn only in a cell, on hover or focus.
        expect(el.shadowRoot.querySelector('thead lightning-icon[icon-name="utility:lock"]')).toBeNull();
        const locks = [...el.shadowRoot.querySelectorAll('td .rh-cell-content > button:disabled')];
        expect(locks.length).toBe(2); // one per row, in PRO Number's cells
        locks.forEach(b => expect(b.dataset.field).toBe('Pro_Number__c'));
        el.remove();
    });

    it('paints the shown pencil Salesforce data-table blue, and never the lock', () => {
        const css = fs
            .readFileSync(path.join(__dirname, '..', 'gridTable.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const blue = [];
        const re = /([^{}]+)\{([^}]*)\}/g;
        let m;
        while ((m = re.exec(css))) {
            const hook = /--slds-s-icon-color-foreground:\s*([^;]+);/.exec(m[2]);
            if (hook)
                blue.push({
                    selectors: m[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')),
                    value: hook[1].trim()
                });
        }
        // The global hook SLDS uses for its own pencil, with its light-theme value as fallback.
        const accent = 'var(--slds-g-color-accent-2, #0250d9)';
        expect(blue).toEqual([
            {
                selectors: [
                    '.rh-cell:hover .rh-cell-content > button:enabled',
                    '.rh-cell:focus-within .rh-cell-content > button:enabled'
                ],
                value: accent
            },
            // The column menu's arrow and a card's pencil, the list view's blue too.
            { selectors: ['.rh-menu-button'], value: accent },
            { selectors: ['.rh-card-pencil'], value: accent }
        ]);
    });

    it('the only button directly inside a cell is its edit button, pencil or lock', async () => {
        const el = createElement('rowhouse-grid-table', { is: GridTable });
        const cols = columns.map(c => (c.field === 'Consignee__c' ? { ...c, editable: false } : c));
        el.config = { columns: cols, rows: seedRows.slice(0, 5) };
        document.body.appendChild(el);
        await flush();
        const buttons = [...el.shadowRoot.querySelectorAll('td .rh-cell-content > button')];
        expect(buttons.length).toBe(5 * cols.length);
        buttons.forEach(b => expect(b.classList).toContain('slds-cell-edit__button'));
        // Locks: exactly the read-only columns (PRO Number in the fixture, and Consignee here).
        const readOnly = cols.filter(c => !c.editable).map(c => c.field);
        const locks = buttons.filter(b => b.disabled);
        expect(locks.length).toBe(5 * readOnly.length);
        locks.forEach(b => expect(readOnly).toContain(b.dataset.field));
        el.remove();
    });
});
