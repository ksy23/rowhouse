/**
 * The grid file: what an export writes, what its name is, and that reading
 * refuses anything that is not a grid file in words an admin can act on.
 */
import {
    FILE_KIND,
    FILE_VERSION,
    MAX_GRIDS,
    NOT_A_GRID_FILE,
    contents,
    fileFor,
    fileName,
    fileText,
    listed,
    readGridFile,
    readText
} from 'c/gridConfigFile';

const DRAFT = {
    config: {
        name: 'Consignments',
        label: 'Consignments',
        isNew: false,
        archived: true,
        objectApiName: 'Consignment__c',
        pageSize: 50
    },
    columns: [{ name: 'Consignments_Name', field: 'Name' }],
    rules: [{ name: 'Consignments_Late', label: 'Late' }],
    filters: [],
    actions: [],
    children: [{ name: 'Consignments_Items', childConfig: 'Consignment_Items' }]
};
const WHEN = new Date(2026, 9, 11, 9, 30);

describe('writing', () => {
    it('writes the kind, the version, when, and each grid without what only its org keeps', () => {
        const file = fileFor([DRAFT], WHEN);
        expect(file.kind).toBe(FILE_KIND);
        expect(file.version).toBe(FILE_VERSION);
        expect(file.exported).toBe(WHEN.toISOString());
        expect(file.grids).toHaveLength(1);
        expect(file.grids[0].config).toEqual({
            name: 'Consignments',
            label: 'Consignments',
            objectApiName: 'Consignment__c',
            pageSize: 50
        });
        expect(file.grids[0].columns).toEqual(DRAFT.columns);
        expect(file.grids[0].children).toEqual(DRAFT.children);
        expect(DRAFT.config.isNew).toBe(false); // the draft itself is left as it was
    });

    it('gives every list, empty when a draft has none', () => {
        const file = fileFor([{ config: { name: 'Open_Cases' } }], WHEN);
        expect(Object.keys(file.grids[0])).toEqual(['config', 'columns', 'rules', 'filters', 'actions', 'children']);
        expect(file.grids[0].rules).toEqual([]);
    });

    it('is indented JSON that reads back as the same grids', () => {
        const text = fileText([DRAFT], WHEN);
        expect(text).toContain('\n  "kind": "rowhouse-grids",\n');
        expect(text.endsWith('}\n')).toBe(true);
        expect(readGridFile(text)).toEqual(fileFor([DRAFT], WHEN).grids);
    });

    it('names one grid by its API name, and several by the date', () => {
        expect(fileName(['Consignments'], WHEN)).toBe('Consignments.rowhouse.json');
        expect(fileName(['Consignments', 'Open_Cases'], WHEN)).toBe('rowhouse-grids-2026-10-11.json');
    });
});

describe('reading', () => {
    const file = grids => JSON.stringify({ kind: FILE_KIND, version: 1, exported: '', grids });

    it('refuses what is not a grid file', () => {
        for (const text of ['', 'Name,Phone\nA,1', '[1,2]', '{"kind":"something-else","grids":[]}', 'null']) {
            expect(() => readGridFile(text)).toThrow(NOT_A_GRID_FILE);
        }
    });

    it('refuses a file from a newer Rowhouse rather than guess at it', () => {
        expect(() => readGridFile(JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION + 1, grids: [] }))).toThrow(
            'This file was exported from a newer Rowhouse. Upgrade Rowhouse in this org, then import it.'
        );
    });

    it('refuses a file with no grids, or more than can be imported at once', () => {
        expect(() => readGridFile(file([]))).toThrow('The file has no grids.');
        const many = Array.from({ length: MAX_GRIDS + 1 }, (_, i) => ({ config: { name: `Harbor_${i}` } }));
        expect(() => readGridFile(file(many))).toThrow(`The file has 51 grids. Import at most ${MAX_GRIDS} at a time.`);
    });

    it('refuses a grid that is not one', () => {
        expect(() => readGridFile(file([{ config: { name: 'A' } }, 'B']))).toThrow(
            'Grid 2 in the file is not a grid. Export the grids again.'
        );
        expect(() => readGridFile(file([{ config: { name: 'A' }, columns: 'Name' }]))).toThrow(
            'Grid 1 in the file is not a grid.'
        );
    });

    it('reads a file an editor saved with a byte order mark, and fills in a list left out', () => {
        const grids = readGridFile(String.fromCharCode(0xfeff) + file([{ config: { name: 'Open_Cases' } }]));
        expect(grids).toEqual([
            { config: { name: 'Open_Cases' }, columns: [], rules: [], filters: [], actions: [], children: [] }
        ]);
    });

    it('reads a chosen file as text, and refuses one over 2 MB', async () => {
        const chosen = new File([fileText([DRAFT], WHEN)], 'Consignments.rowhouse.json', { type: 'application/json' });
        expect(readGridFile(await readText(chosen))[0].config.name).toBe('Consignments');
        await expect(readText({ size: 3 * 1024 * 1024 })).rejects.toThrow(
            'The file is larger than 2 MB. Export fewer grids at a time.'
        );
    });
});

describe('words', () => {
    it('says what a grid holds', () => {
        expect(contents(DRAFT)).toBe('1 column, 1 display rule and 1 child table');
        expect(contents({ columns: [{}, {}] })).toBe('2 columns');
        expect(contents(null)).toBe('0 columns');
    });

    it('lists titles as a person would', () => {
        expect(listed(['A'])).toBe('A');
        expect(listed(['A', 'B'])).toBe('A and B');
        expect(listed(['A', 'B', 'C'])).toBe('A, B and C');
    });
});
