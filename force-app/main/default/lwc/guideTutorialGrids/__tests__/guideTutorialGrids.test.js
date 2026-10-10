/**
 * The grids each tutorial builds: what the build steps leave (the counts the
 * steps' Save lines give), a child table's grid before the grid that shows
 * it, child total columns that name a child table of their own grid, nothing
 * the server should name, and every tutorial page carrying its button.
 */
import { TUTORIAL_IDS, contents, gridsFor } from 'c/guideTutorialGrids';

/* global require, __dirname -- Jest runs in Node, where the test reads the tutorial pages. */
const fs = require('fs');
const path = require('path');

const PAGES = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'guide', 'pages');

/** Per tutorial, per grid: [name, object, columns, display rules, filters, actions, child tables]. */
const EXPECTED = {
    'tutorial-leads': [['Lead_Queue', 'Lead', 7, 3, 1, 1, 0]],
    'tutorial-groups': [
        ['Subsidiaries', 'Account', 4, 0, 0, 0, 0],
        ['Account_Groups', 'Account', 6, 1, 1, 0, 1]
    ],
    'tutorial-contacts': [['Account_People', 'Contact', 6, 1, 1, 0, 0]],
    'tutorial-cleanup': [['Contact_Cleanup', 'Contact', 9, 0, 0, 0, 0]],
    'tutorial-accounts': [
        ['Key_Account_Contacts', 'Contact', 4, 0, 0, 0, 0],
        ['Key_Account_Deals', 'Opportunity', 4, 0, 0, 0, 0],
        ['Key_Accounts', 'Account', 6, 0, 0, 0, 2]
    ],
    'tutorial-pipeline': [['Pipeline_Review', 'Opportunity', 8, 3, 0, 0, 0]],
    'tutorial-assets': [
        ['Account_Assets', 'Asset', 5, 3, 0, 0, 0],
        ['Installed_Base', 'Account', 5, 0, 0, 0, 1]
    ],
    'tutorial-service': [['Service_Triage', 'Case', 8, 3, 0, 1, 0]]
};

describe('the tutorials', () => {
    it('covers every tutorial, and nothing else', () => {
        expect([...TUTORIAL_IDS].sort()).toEqual(Object.keys(EXPECTED).sort());
        expect(gridsFor('tutorials')).toEqual([]);
        expect(gridsFor(undefined)).toEqual([]);
    });

    it.each(Object.keys(EXPECTED))('%s: the grids its build steps leave', tutorial => {
        const got = gridsFor(tutorial).map(d => [
            d.config.name,
            d.config.objectApiName,
            d.columns.length,
            d.rules.length,
            d.filters.length,
            d.actions.length,
            d.children.length
        ]);
        expect(got).toEqual(EXPECTED[tutorial]);
    });

    it.each(Object.keys(EXPECTED))('%s: each page carries its Build button', tutorial => {
        const page = fs.readFileSync(path.join(PAGES, `${tutorial}.html`), 'utf8');
        expect(page).toContain(`<c-guide-build-grid tutorial="${tutorial}"></c-guide-build-grid>`);
    });
});

describe('the drafts', () => {
    const all = TUTORIAL_IDS.map(t => [t, gridsFor(t)]);

    it.each(all)('%s: new grids, records the server names, no template keys', (tutorial, drafts) => {
        drafts.forEach(d => {
            expect(d.config.isNew).toBe(true);
            expect(d.config.label.length).toBeLessThanOrEqual(40);
            ['columns', 'rules', 'filters', 'actions'].forEach(list =>
                d[list].forEach(item => {
                    expect(item.name).toBeNull();
                    expect(item._key).toBeUndefined();
                })
            );
            d.children.forEach(ch => expect(ch.name).toMatch(new RegExp(`^${d.config.name}_`)));
        });
    });

    it.each(all)('%s: a child table names a grid built before it', (tutorial, drafts) => {
        drafts.forEach((d, i) => {
            const before = drafts.slice(0, i).map(x => x.config.name);
            d.children.forEach(ch => expect(before).toContain(ch.childConfig));
        });
    });

    it.each(all)('%s: a child total column names one of its own child tables', (tutorial, drafts) => {
        drafts.forEach(d => {
            const tables = d.children.map(ch => ch.name);
            d.columns.filter(c => c.childTable).forEach(c => expect(tables).toContain(c.childTable));
        });
    });

    it('keeps the values the steps give', () => {
        const [queue] = gridsFor('tutorial-leads');
        expect(queue.filters[0]).toMatchObject({
            label: 'Open leads',
            field: 'Status',
            operator: 'not_contains',
            value: 'Closed'
        });
        expect(queue.rules[0]).toMatchObject({ field: null, applyTo: 'row', style: 'fill_red' });
        expect(queue.actions[0]).toMatchObject({ type: 'QuickAction', actionName: 'LogACall', showIn: 'Row' });
        const [pipeline] = gridsFor('tutorial-pipeline');
        expect(pipeline.config).toMatchObject({ sortField: 'CloseDate', sortDirection: 'asc', frozenColumns: 1 });
        expect(pipeline.rules[1]).toMatchObject({ label: 'Big deal', operator: 'greater_or_equal', value: '250000' });
        expect(pipeline.columns[2]).toMatchObject({ field: 'StageName', groupLevel: 1 });
        const [triage] = gridsFor('tutorial-service');
        expect(triage.config).toMatchObject({ sortDirection: 'desc', height: 480 });
        const [cleanup] = gridsFor('tutorial-cleanup');
        expect(cleanup.config).toMatchObject({ allowImport: true, logChanges: true });
        expect(cleanup.columns.every(c => c.editable)).toBe(true);
        const [people] = gridsFor('tutorial-contacts');
        expect(people.config.recordPageField).toBe('AccountId');
        expect(people.columns[5]).toMatchObject({
            formula: 'TODAY() - DATEVALUE(CreatedDate)',
            decimalPlaces: 0,
            columnLabel: 'Days on file'
        });
        const [assets, base] = gridsFor('tutorial-assets');
        expect(assets.rules[0]).toMatchObject({ operator: 'between', value: 'TODAY', valueTo: 'TODAY+90' });
        expect(base.columns[4]).toMatchObject({
            childTotal: 'min',
            childField: 'UsageEndDate',
            columnLabel: 'Earliest warranty end'
        });
    });

    it('gives a fresh copy each time', () => {
        const a = gridsFor('tutorial-leads');
        a[0].columns.length = 0;
        expect(gridsFor('tutorial-leads')[0].columns).toHaveLength(7);
    });
});

describe('what a grid holds, in words', () => {
    it('lists what is there', () => {
        expect(contents(gridsFor('tutorial-leads')[0])).toBe('7 columns, 3 display rules, 1 filter and 1 action');
        expect(contents(gridsFor('tutorial-groups')[0])).toBe('4 columns');
        expect(contents(gridsFor('tutorial-accounts')[2])).toBe('6 columns and 2 child tables');
    });
});
