/**
 * Field-type rules: lookup names and links, dependent picklist values
 * (TC-037..039), and the clears an edit of a controlling field forces.
 */
import { isLookup, lookupText, lookupHref, nameIndex, dependentOptions, isValidDependent, dependentClears } from 'c/gridFields';

const ACCOUNT = '001000000000001AAA';
const QUEUE = '00G000000000001AAA';
const DEPENDENT = {
    field: 'Dependent_Picklist__c', type: 'picklist', editable: true, dependentOn: 'Controlling_Picklist__c',
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
