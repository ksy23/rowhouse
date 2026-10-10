/**
 * Field-type rules: lookup names and links, dependent picklist values
 * (TC-037..039), the clears an edit of a controlling field forces, and the
 * values a row's record type allows.
 */
import {
    isLookup,
    lookupText,
    lookupHref,
    nameIndex,
    unknownNames,
    namesFound,
    MAX_NAME_LOOKUP,
    dependentOptions,
    isValidDependent,
    dependentClears,
    recordTypeValues,
    allowedValues,
    rowOptions,
    sharedOptions,
    isAllowedForRecordType
} from 'c/gridFields';

const ACCOUNT = '001000000000001AAA';
const QUEUE = '00G000000000001AAA';
const DEPENDENT = {
    field: 'Dependent_Picklist__c',
    type: 'picklist',
    editable: true,
    dependentOn: 'Controlling_Picklist__c',
    options: [
        { value: 'Keyboard', label: 'Keyboard', validFor: ['Hardware'] },
        { value: 'Monitor', label: 'Monitor', validFor: ['Hardware'] },
        { value: 'Licence', label: 'Licence', validFor: ['Software'] },
        { value: 'Either', label: 'Either', validFor: ['Hardware', 'Software'] }
    ]
};

describe('lookups', () => {
    it('knows lookup and owner columns', () => {
        expect(isLookup('reference')).toBe(true);
        expect(isLookup('owner')).toBe(true);
        expect(isLookup('picklist')).toBe(false);
    });

    it('shows the record name when known, the Id otherwise, and nothing for blank', () => {
        expect(lookupText(ACCOUNT, { [ACCOUNT]: 'Acme' })).toBe('Acme');
        expect(lookupText(ACCOUNT, {})).toBe(ACCOUNT);
        expect(lookupText(null, { [ACCOUNT]: 'Acme' })).toBe('');
    });

    it('links a record but not a queue, which has no record page', () => {
        expect(lookupHref(ACCOUNT)).toBe(`/lightning/r/${ACCOUNT}/view`);
        expect(lookupHref(QUEUE)).toBeNull();
        expect(lookupHref('not an id')).toBeNull();
        expect(lookupHref(null)).toBeNull();
    });

    it('indexes names case-insensitively, keeping every record that shares one', () => {
        const index = nameIndex({ a: 'Acme', b: 'ACME', c: 'Other' });
        expect(index.get('acme')).toEqual(['a', 'b']);
        expect(index.get('other')).toEqual(['c']);
    });
});

describe('dependent picklists', () => {
    it('TC-037: offers only the values valid for the controlling value', () => {
        expect(dependentOptions(DEPENDENT, 'Hardware').map(o => o.value)).toEqual(['Keyboard', 'Monitor', 'Either']);
        expect(dependentOptions(DEPENDENT, 'Software').map(o => o.value)).toEqual(['Licence', 'Either']);
    });

    it('TC-039: offers nothing for a controlling value with no dependents, or a blank one', () => {
        expect(dependentOptions(DEPENDENT, 'Services')).toEqual([]);
        expect(dependentOptions(DEPENDENT, null)).toEqual([]);
    });

    it('reads a checkbox controller as true and false', () => {
        const byCheckbox = { options: [{ value: 'Yes only', validFor: ['true'] }] };
        expect(dependentOptions(byCheckbox, true)).toHaveLength(1);
        expect(dependentOptions(byCheckbox, false)).toHaveLength(0);
    });

    it('treats blank as valid, and a value as valid only if offered', () => {
        expect(isValidDependent(DEPENDENT, null, 'Software')).toBe(true);
        expect(isValidDependent(DEPENDENT, 'Licence', 'Software')).toBe(true);
        expect(isValidDependent(DEPENDENT, 'Monitor', 'Software')).toBe(false);
    });
});

describe('dependentClears', () => {
    const columns = [{ field: 'Controlling_Picklist__c', type: 'picklist', editable: true }, DEPENDENT];
    const state = { r1: { Controlling_Picklist__c: 'Hardware', Dependent_Picklist__c: 'Monitor' } };
    const current = (id, f) => state[id][f];
    const original = (id, f) => state[id][f];
    const edit = value => [{ recordId: 'r1', field: 'Controlling_Picklist__c', value, originalValue: 'Hardware' }];

    it('clears a dependent value the new controlling value does not offer', () => {
        expect(dependentClears(edit('Software'), columns, current, original)).toEqual([
            { recordId: 'r1', field: 'Dependent_Picklist__c', value: null, originalValue: 'Monitor' }
        ]);
    });

    it('leaves a dependent value the new controlling value still offers', () => {
        const either = { r1: { Controlling_Picklist__c: 'Hardware', Dependent_Picklist__c: 'Either' } };
        expect(dependentClears(edit('Software'), columns, (id, f) => either[id][f], original)).toEqual([]);
    });

    it('TC-038: forces nothing when the controlling value did not change', () => {
        const invalid = { r1: { Controlling_Picklist__c: 'Software', Dependent_Picklist__c: 'Monitor' } };
        expect(dependentClears(edit('Software'), columns, (id, f) => invalid[id][f], original)).toEqual([]);
    });

    it('leaves a dependent value set by the same action, and one the user cannot edit', () => {
        const both = [...edit('Software'), { recordId: 'r1', field: 'Dependent_Picklist__c', value: 'Licence' }];
        expect(dependentClears(both, columns, current, original)).toEqual([]);
        const readOnly = [columns[0], { ...DEPENDENT, editable: false }];
        expect(dependentClears(edit('Software'), readOnly, current, original)).toEqual([]);
    });
});

describe('names to find on the server', () => {
    const NAMES = { '001000000000001AAA': 'Alpha Corp' };

    it('leaves out names the grid has, record Ids and blanks; distinct, as typed', () => {
        expect(
            unknownNames(
                [
                    'alpha corp',
                    'Edge Communications',
                    'edge communications',
                    '001000000000002AAA',
                    '  ',
                    null,
                    ' Twin Co '
                ],
                NAMES
            )
        ).toEqual(['Edge Communications', 'Twin Co']);
    });

    it('asks for at most MAX_NAME_LOOKUP at once', () => {
        const many = Array.from({ length: MAX_NAME_LOOKUP + 5 }, (_, i) => 'Name ' + i);
        expect(unknownNames(many, {})).toHaveLength(MAX_NAME_LOOKUP);
    });

    it("reads the server's answer as { [id]: name }", () => {
        expect(
            namesFound({
                'twin co': [
                    { id: '001000000000004AAA', name: 'Twin Co' },
                    { id: '001000000000005AAA', name: 'Twin Co' }
                ],
                edge: [{ id: '001000000000006AAA', name: 'Edge' }]
            })
        ).toEqual({ '001000000000004AAA': 'Twin Co', '001000000000005AAA': 'Twin Co', '001000000000006AAA': 'Edge' });
        expect(namesFound(null)).toEqual({});
    });
});

describe('record types', () => {
    const STANDARD = '012000000000001AAA';
    const RESTRICTED = '012000000000002AAA';
    const STATUS = {
        field: 'Status__c',
        type: 'picklist',
        options: ['New', 'Working', 'Closed', 'Archived'].map(v => ({ value: v, label: v + ' label' }))
    };
    const BY_TYPE = {
        [STANDARD]: { status__c: ['New', 'Working', 'Closed'] },
        [RESTRICTED]: { status__c: ['New', 'Archived'] }
    };
    const values = options => options.map(o => o.value);

    it("reads Salesforce's answer by field, and a packaged field by its own name too", () => {
        const fields = recordTypeValues({
            picklistFieldValues: {
                Status__c: { values: [{ value: 'New' }, { value: 'Working' }] },
                acme__Tier__c: { values: [{ value: 'Gold' }] },
                StageName: { values: [] }
            }
        });
        expect(fields).toEqual({
            status__c: ['New', 'Working'],
            acme__tier__c: ['Gold'],
            tier__c: ['Gold'],
            stagename: []
        });
        expect(recordTypeValues(undefined)).toEqual({});
    });

    it("narrows a picklist to what the row's record type allows", () => {
        expect([...allowedValues(STATUS, { RecordTypeId: RESTRICTED }, BY_TYPE)]).toEqual(['New', 'Archived']);
        expect(values(rowOptions(STATUS, { RecordTypeId: STANDARD }, null, BY_TYPE, 'New'))).toEqual([
            'New',
            'Working',
            'Closed'
        ]);
    });

    it('leaves them as they are when nothing narrows them', () => {
        expect(allowedValues(STATUS, { RecordTypeId: STANDARD }, null)).toBeNull();
        expect(allowedValues(STATUS, {}, BY_TYPE)).toBeNull();
        expect(allowedValues(STATUS, { RecordTypeId: '012000000000009AAA' }, BY_TYPE)).toBeNull();
        expect(allowedValues({ ...STATUS, field: 'Other__c' }, { RecordTypeId: STANDARD }, BY_TYPE)).toBeNull();
        expect(allowedValues({ field: 'Status__c', type: 'string' }, { RecordTypeId: STANDARD }, BY_TYPE)).toBeNull();
        expect(rowOptions(STATUS, { RecordTypeId: STANDARD }, null, null, null)).toBe(STATUS.options);
    });

    it("keeps the row's own value, by its label, though its record type does not offer it", () => {
        const offered = rowOptions(STATUS, { RecordTypeId: RESTRICTED }, null, BY_TYPE, 'Working');
        expect(offered.map(o => o.label)).toEqual(['New label', 'Working label', 'Archived label']);
    });

    it("narrows a dependent picklist's values for its controlling value too", () => {
        const dependent = {
            field: 'Status__c',
            type: 'picklist',
            dependentOn: 'Kind__c',
            options: [
                { value: 'New', label: 'New', validFor: ['A'] },
                { value: 'Working', label: 'Working', validFor: ['A'] },
                { value: 'Archived', label: 'Archived', validFor: ['B'] }
            ]
        };
        expect(values(rowOptions(dependent, { RecordTypeId: RESTRICTED }, 'A', BY_TYPE, null))).toEqual(['New']);
        expect(values(rowOptions(dependent, { RecordTypeId: RESTRICTED }, null, BY_TYPE, null))).toEqual([]);
    });

    it('a multi-select keeps each of its own values', () => {
        const multi = { ...STATUS, type: 'multipicklist' };
        expect(values(rowOptions(multi, { RecordTypeId: RESTRICTED }, null, BY_TYPE, 'Working;Closed'))).toEqual([
            'New',
            'Working',
            'Closed',
            'Archived'
        ]);
        expect(isAllowedForRecordType(multi, 'New;Archived', { RecordTypeId: RESTRICTED }, BY_TYPE)).toBe(true);
        expect(isAllowedForRecordType(multi, 'New;Working', { RecordTypeId: RESTRICTED }, BY_TYPE)).toBe(false);
    });

    it('across rows, offers what every row allows', () => {
        const rows = [{ RecordTypeId: STANDARD }, { RecordTypeId: RESTRICTED }, {}];
        expect(values(sharedOptions(STATUS, rows, BY_TYPE))).toEqual(['New']);
        expect(values(sharedOptions(STATUS, [{ RecordTypeId: STANDARD }], BY_TYPE))).toEqual([
            'New',
            'Working',
            'Closed'
        ]);
        expect(sharedOptions(STATUS, rows, null)).toBe(STATUS.options);
    });

    it('allows a blank always, and only offered values otherwise', () => {
        const row = { RecordTypeId: STANDARD };
        expect(isAllowedForRecordType(STATUS, null, row, BY_TYPE)).toBe(true);
        expect(isAllowedForRecordType(STATUS, 'Closed', row, BY_TYPE)).toBe(true);
        expect(isAllowedForRecordType(STATUS, 'Archived', row, BY_TYPE)).toBe(false);
        expect(isAllowedForRecordType(STATUS, 'Archived', {}, BY_TYPE)).toBe(true);
    });
});
