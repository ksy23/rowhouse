/**
 * The user's column filters: what the panel offers for each type, when
 * a filter is complete enough to send, how it reads as a chip, and how the
 * list of filters changes.
 */
import {
    MAX_FILTERS,
    IS_ME,
    canFilter,
    operatorsFor,
    needsValue,
    inputKind,
    choicesFor,
    toRequest,
    problemOf,
    describeFilter,
    withFilter
} from 'c/gridFilters';

const values = list => list.map(o => o.value);
const STAGE = {
    field: 'Stage__c',
    label: 'Stage',
    type: 'picklist',
    filterable: true,
    options: [
        { value: 'Open', label: 'Open' },
        { value: 'Closed_Won', label: 'Closed Won' }
    ]
};
const AMOUNT = { field: 'Amount__c', label: 'Amount', type: 'currency', scale: 2, filterable: true };
const OWNER = { field: 'OwnerId', label: 'Owner', type: 'owner', referenceTo: ['User'], filterable: true };
const ACCOUNT = {
    field: 'Account__c',
    label: 'Account',
    type: 'reference',
    referenceTo: ['Account'],
    filterable: true
};

describe('which columns can be filtered', () => {
    it('is what the server says, never a formula column', () => {
        expect(canFilter(STAGE)).toBe(true);
        expect(canFilter({ ...STAGE, filterable: false })).toBe(false);
        expect(canFilter({ field: 'X', type: 'text' })).toBe(false);
        expect(canFilter({ ...AMOUNT, isFormula: true })).toBe(false);
        expect(canFilter(null)).toBe(false);
    });
});

describe('the conditions each type offers', () => {
    it('offers text, picklist, multi-select and checkbox conditions', () => {
        expect(values(operatorsFor({ type: 'text' }))).toEqual([
            'contains',
            'not_contains',
            'equals',
            'not_equals',
            'starts_with',
            'is_blank',
            'is_not_blank'
        ]);
        expect(values(operatorsFor(STAGE))).toEqual(['equals', 'not_equals', 'is_blank', 'is_not_blank']);
        expect(operatorsFor({ type: 'multipicklist' }).map(o => o.label)).toEqual([
            'Includes',
            'Excludes',
            'Is blank',
            'Is not blank'
        ]);
        expect(values(operatorsFor({ type: 'checkbox' }))).toEqual(['equals']);
    });

    it('offers comparisons and Between for numbers, times and dates; dates in calendar words', () => {
        expect(values(operatorsFor(AMOUNT))).toContain('between');
        expect(values(operatorsFor({ type: 'time' }))).toContain('greater_than');
        const date = operatorsFor({ type: 'date' });
        expect(date.map(o => o.label).slice(0, 7)).toEqual([
            'On',
            'Not on',
            'After',
            'On or after',
            'Before',
            'On or before',
            'Between'
        ]);
        expect(operatorsFor({ type: 'datetime' })).toBe(date);
    });

    it('filters a lookup by its record name, and a lookup to users also by "is me"', () => {
        expect(values(operatorsFor(ACCOUNT))).toEqual(['contains', 'is_blank', 'is_not_blank']);
        expect(values(operatorsFor(OWNER))).toEqual([IS_ME, 'contains', 'is_blank', 'is_not_blank']);
    });
});

describe('the value box', () => {
    it('is none for the blank tests and "is me"', () => {
        expect(needsValue('is_blank')).toBe(false);
        expect(needsValue('is_not_blank')).toBe(false);
        expect(needsValue(IS_ME)).toBe(false);
        expect(needsValue('equals')).toBe(true);
        expect(inputKind(STAGE, 'is_blank')).toBe('none');
    });

    it('is a list, a date, a time, a number or text, by type', () => {
        expect(inputKind(STAGE, 'equals')).toBe('select');
        expect(inputKind({ type: 'checkbox' }, 'equals')).toBe('select');
        expect(inputKind({ type: 'datetime' }, 'equals')).toBe('date');
        expect(inputKind({ type: 'time' }, 'equals')).toBe('time');
        expect(inputKind(AMOUNT, 'between')).toBe('number');
        expect(inputKind(ACCOUNT, 'contains')).toBe('text');
    });

    it('lists a picklist’s values, or Checked and Not checked', () => {
        expect(choicesFor(STAGE)).toEqual([
            { value: 'Open', label: 'Open' },
            { value: 'Closed_Won', label: 'Closed Won' }
        ]);
        expect(values(choicesFor({ type: 'checkbox' }))).toEqual(['true', 'false']);
    });
});

describe('what goes to the server', () => {
    it('sends a complete filter, values as text', () => {
        expect(toRequest({ field: 'Amount__c', operator: 'greater_than', value: 1000 })).toEqual({
            field: 'Amount__c',
            operator: 'greater_than',
            value: '1000',
            valueTo: null
        });
        expect(toRequest({ field: 'Amount__c', operator: 'between', value: '1', valueTo: '9' })).toEqual({
            field: 'Amount__c',
            operator: 'between',
            value: '1',
            valueTo: '9'
        });
    });

    it('sends "is me" as equals $User, and the blank tests without a value', () => {
        expect(toRequest({ field: 'OwnerId', operator: IS_ME })).toEqual({
            field: 'OwnerId',
            operator: 'equals',
            value: '$User',
            valueTo: null
        });
        expect(toRequest({ field: 'Stage__c', operator: 'is_blank', value: 'ignored' })).toEqual({
            field: 'Stage__c',
            operator: 'is_blank',
            value: null,
            valueTo: null
        });
    });

    it('sends nothing when a value is missing, or Between lacks an end', () => {
        expect(toRequest({ field: 'Amount__c', operator: 'equals', value: '' })).toBeNull();
        expect(toRequest({ field: 'Amount__c', operator: 'between', value: '1', valueTo: '' })).toBeNull();
        expect(toRequest({ operator: 'equals', value: '1' })).toBeNull();
        expect(toRequest(null)).toBeNull();
    });

    it('says why a filter cannot be applied yet', () => {
        expect(problemOf({ operator: null }, AMOUNT)).toBe('Choose a condition.');
        expect(problemOf({ operator: 'equals', value: '' }, AMOUNT)).toBe('Enter a value.');
        expect(problemOf({ operator: 'between', value: '1', valueTo: '' }, AMOUNT)).toBe(
            'Enter both ends of the range.'
        );
        expect(problemOf({ operator: 'equals', value: '1,000' }, AMOUNT)).toBe('Enter a number, such as 1000.');
        expect(problemOf({ operator: 'between', value: '1', valueTo: 'x' }, AMOUNT)).toBe(
            'Enter a number, such as 1000.'
        );
        expect(problemOf({ operator: 'equals', value: '-1.5' }, AMOUNT)).toBe('');
        expect(problemOf({ operator: 'is_blank' }, AMOUNT)).toBe('');
    });
});

describe('a filter in words, for its chip', () => {
    it('names the column, the condition and the value as the grid shows it', () => {
        expect(describeFilter({ field: 'Stage__c', operator: 'equals', value: 'Closed_Won' }, STAGE)).toBe(
            'Stage equals Closed Won'
        );
        expect(describeFilter({ field: 'Stage__c', operator: 'is_blank' }, STAGE)).toBe('Stage is blank');
        expect(
            describeFilter(
                { field: 'Name', operator: 'contains', value: 'acme' },
                { field: 'Name', label: 'Name', type: 'text' }
            )
        ).toBe('Name contains “acme”');
        expect(
            describeFilter(
                { field: 'Done__c', operator: 'equals', value: 'true' },
                { field: 'Done__c', label: 'Done', type: 'checkbox' }
            )
        ).toBe('Done is checked');
    });

    it('reads Between with both ends', () => {
        const text = describeFilter({ field: 'Amount__c', operator: 'between', value: '1', valueTo: '9' }, AMOUNT);
        expect(text).toMatch(/^Amount between .*1\.00 and .*9\.00$/);
    });

    it('reads "is me" both as the panel holds it and as the server took it', () => {
        expect(describeFilter({ field: 'OwnerId', operator: IS_ME }, OWNER)).toBe('Owner is me');
        expect(describeFilter({ field: 'OwnerId', operator: 'equals', value: '$User' }, OWNER)).toBe('Owner is me');
    });
});

describe('the list of filters', () => {
    const a = { field: 'A', operator: 'equals', value: '1' };
    const b = { field: 'B', operator: 'equals', value: '2' };

    it('adds a column’s filter, replaces it in place, and removes it', () => {
        const one = withFilter([], 'A', a);
        expect(one).toEqual([a]);
        const two = withFilter(one, 'B', b);
        expect(two).toEqual([a, b]);
        const replaced = withFilter(two, 'A', { ...a, value: '3' });
        expect(replaced.map(f => f.field)).toEqual(['A', 'B']);
        expect(replaced[0].value).toBe('3');
        expect(withFilter(replaced, 'A', null)).toEqual([b]);
    });

    it('hands back the same list when nothing changes', () => {
        const list = [a];
        expect(withFilter(list, 'Z', null)).toBe(list);
    });

    it('adds no column past the most one grid takes, but still changes one already filtered', () => {
        const full = Array.from({ length: MAX_FILTERS }, (_, i) => ({ field: 'F' + i, operator: 'is_blank' }));
        expect(withFilter(full, 'New', a)).toBe(full);
        expect(withFilter(full, 'F0', { field: 'F0', operator: 'is_not_blank' })[0].operator).toBe('is_not_blank');
    });
});
