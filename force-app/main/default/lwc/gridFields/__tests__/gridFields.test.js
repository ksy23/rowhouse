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
    field: 'Equipment__c',
    type: 'picklist',
    editable: true,
    dependentOn: 'Mode__c',
    options: [
        { value: 'Dry Van', label: 'Dry Van', validFor: ['Truckload'] },
        { value: 'Reefer', label: 'Reefer', validFor: ['Truckload'] },
        { value: 'Pallet', label: 'Pallet', validFor: ['LTL'] },
        { value: 'Flatbed', label: 'Flatbed', validFor: ['Truckload', 'LTL'] }
    ]
};

describe('lookups', () => {
    it('knows lookup and owner columns', () => {
        expect(isLookup('reference')).toBe(true);
        expect(isLookup('owner')).toBe(true);
        expect(isLookup('picklist')).toBe(false);
    });

    it('shows the record name when known, the Id otherwise, and nothing for blank', () => {
        expect(lookupText(ACCOUNT, { [ACCOUNT]: 'Casco Bay Marine' })).toBe('Casco Bay Marine');
        expect(lookupText(ACCOUNT, {})).toBe(ACCOUNT);
        expect(lookupText(null, { [ACCOUNT]: 'Casco Bay Marine' })).toBe('');
    });

    it('links a record but not a queue, which has no record page', () => {
        expect(lookupHref(ACCOUNT)).toBe(`/lightning/r/${ACCOUNT}/view`);
        expect(lookupHref(QUEUE)).toBeNull();
        expect(lookupHref('Casco Bay Marine')).toBeNull();
        expect(lookupHref(null)).toBeNull();
    });

    it('indexes names case-insensitively, keeping every record that shares one', () => {
        const index = nameIndex({ a: 'Casco Bay Marine', b: 'CASCO BAY MARINE', c: 'Wachusett Paper' });
        expect(index.get('casco bay marine')).toEqual(['a', 'b']);
        expect(index.get('wachusett paper')).toEqual(['c']);
    });
});

describe('dependent picklists', () => {
    it('TC-037: offers only the values valid for the controlling value', () => {
        expect(dependentOptions(DEPENDENT, 'Truckload').map(o => o.value)).toEqual(['Dry Van', 'Reefer', 'Flatbed']);
        expect(dependentOptions(DEPENDENT, 'LTL').map(o => o.value)).toEqual(['Pallet', 'Flatbed']);
    });

    it('TC-039: offers nothing for a controlling value with no dependents, or a blank one', () => {
        expect(dependentOptions(DEPENDENT, 'Parcel')).toEqual([]);
        expect(dependentOptions(DEPENDENT, null)).toEqual([]);
    });

    it('reads a checkbox controller as true and false', () => {
        const byCheckbox = { options: [{ value: 'Placarded', validFor: ['true'] }] };
        expect(dependentOptions(byCheckbox, true)).toHaveLength(1);
        expect(dependentOptions(byCheckbox, false)).toHaveLength(0);
    });

    it('treats blank as valid, and a value as valid only if offered', () => {
        expect(isValidDependent(DEPENDENT, null, 'LTL')).toBe(true);
        expect(isValidDependent(DEPENDENT, 'Pallet', 'LTL')).toBe(true);
        expect(isValidDependent(DEPENDENT, 'Reefer', 'LTL')).toBe(false);
    });
});

describe('dependentClears', () => {
    const columns = [{ field: 'Mode__c', type: 'picklist', editable: true }, DEPENDENT];
    const state = { r1: { Mode__c: 'Truckload', Equipment__c: 'Reefer' } };
    const current = (id, f) => state[id][f];
    const original = (id, f) => state[id][f];
    const edit = value => [{ recordId: 'r1', field: 'Mode__c', value, originalValue: 'Truckload' }];

    it('clears a dependent value the new controlling value does not offer', () => {
        expect(dependentClears(edit('LTL'), columns, current, original)).toEqual([
            { recordId: 'r1', field: 'Equipment__c', value: null, originalValue: 'Reefer' }
        ]);
    });

    it('leaves a dependent value the new controlling value still offers', () => {
        const either = { r1: { Mode__c: 'Truckload', Equipment__c: 'Flatbed' } };
        expect(dependentClears(edit('LTL'), columns, (id, f) => either[id][f], original)).toEqual([]);
    });

    it('TC-038: forces nothing when the controlling value did not change', () => {
        const invalid = { r1: { Mode__c: 'LTL', Equipment__c: 'Reefer' } };
        expect(dependentClears(edit('LTL'), columns, (id, f) => invalid[id][f], original)).toEqual([]);
    });

    it('leaves a dependent value set by the same action, and one the user cannot edit', () => {
        const both = [...edit('LTL'), { recordId: 'r1', field: 'Equipment__c', value: 'Pallet' }];
        expect(dependentClears(both, columns, current, original)).toEqual([]);
        const readOnly = [columns[0], { ...DEPENDENT, editable: false }];
        expect(dependentClears(edit('LTL'), readOnly, current, original)).toEqual([]);
    });
});

describe('names to find on the server', () => {
    const NAMES = { '001000000000001AAA': 'Quabbin Supply' };

    it('leaves out names the grid has, record Ids and blanks; distinct, as typed', () => {
        expect(
            unknownNames(
                [
                    'quabbin supply',
                    'Penobscot Paper',
                    'penobscot paper',
                    '001000000000002AAA',
                    '  ',
                    null,
                    ' Kennebec Lumber '
                ],
                NAMES
            )
        ).toEqual(['Penobscot Paper', 'Kennebec Lumber']);
    });

    it('asks for at most MAX_NAME_LOOKUP at once', () => {
        const many = Array.from({ length: MAX_NAME_LOOKUP + 5 }, (_, i) => 'Kennebec Lumber Yard ' + i);
        expect(unknownNames(many, {})).toHaveLength(MAX_NAME_LOOKUP);
    });

    it("reads the server's answer as { [id]: name }", () => {
        expect(
            namesFound({
                'kennebec lumber': [
                    { id: '001000000000004AAA', name: 'Kennebec Lumber' },
                    { id: '001000000000005AAA', name: 'Kennebec Lumber' }
                ],
                'penobscot paper': [{ id: '001000000000006AAA', name: 'Penobscot Paper' }]
            })
        ).toEqual({
            '001000000000004AAA': 'Kennebec Lumber',
            '001000000000005AAA': 'Kennebec Lumber',
            '001000000000006AAA': 'Penobscot Paper'
        });
        expect(namesFound(null)).toEqual({});
    });
});

describe('record types', () => {
    const STANDARD = '012000000000001AAA';
    const RESTRICTED = '012000000000002AAA';
    // Labels an admin renamed after the values were made: the API names stay.
    const LABELS = { New: 'Filed', Working: 'Under Review', Closed: 'Settled', Archived: 'Withdrawn' };
    const STATUS = {
        field: 'Status__c',
        type: 'picklist',
        options: ['New', 'Working', 'Closed', 'Archived'].map(v => ({ value: v, label: LABELS[v] }))
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
                gcf__Tier__c: { values: [{ value: 'Gold' }] },
                StageName: { values: [] }
            }
        });
        expect(fields).toEqual({
            status__c: ['New', 'Working'],
            gcf__tier__c: ['Gold'],
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
        expect(offered.map(o => o.label)).toEqual(['Filed', 'Under Review', 'Withdrawn']);
    });

    it("narrows a dependent picklist's values for its controlling value too", () => {
        const dependent = {
            field: 'Status__c',
            type: 'picklist',
            dependentOn: 'Claim_Type__c',
            options: [
                { value: 'New', label: 'New', validFor: ['Damage'] },
                { value: 'Working', label: 'Working', validFor: ['Damage'] },
                { value: 'Archived', label: 'Archived', validFor: ['Shortage'] }
            ]
        };
        expect(values(rowOptions(dependent, { RecordTypeId: RESTRICTED }, 'Damage', BY_TYPE, null))).toEqual(['New']);
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
