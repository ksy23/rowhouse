/**
 * A column of a parent record's field, chosen through lookups: following a
 * path through the objects' describes, the field it ends at, and the field
 * lists the editor shows, one per object on the way.
 */
import { walkPath, pathField, pathSteps, isPathName, MAX_HOPS } from 'c/gridAdminDraft';

const lookup = (name, relationship, label, to) => ({
    name,
    label,
    heading: label.replace(/ ID$/, ''),
    type: 'reference',
    referenceTo: [to],
    relationship,
    reachable: true
});
const CONTACT = {
    name: 'Contact',
    label: 'Contact',
    fields: [
        { name: 'LastName', label: 'Last Name', heading: 'Last Name', type: 'text', editable: true, isName: false },
        lookup('AccountId', 'Account', 'Account ID', 'Account'),
        { ...lookup('WhoId', 'Who', 'Name ID', 'Lead'), reachable: false }
    ]
};
const ACCOUNT = {
    name: 'Account',
    label: 'Account',
    fields: [
        { name: 'Industry', label: 'Industry', heading: 'Industry', type: 'picklist', editable: true, groupable: true },
        { name: 'Name', label: 'Account Name', heading: 'Account Name', type: 'text', editable: true, isName: true },
        lookup('OwnerId', 'Owner', 'Owner ID', 'User')
    ]
};
const USER = {
    name: 'User',
    label: 'User',
    fields: [{ name: 'Email', label: 'Email', heading: 'Email', type: 'email', editable: true }]
};

describe('following a path', () => {
    it('tells a path from a field', () => {
        expect(isPathName('Account.Industry')).toBe(true);
        expect(isPathName('Industry')).toBe(false);
        expect(isPathName(null)).toBe(false);
    });

    it('reaches the field through each lookup and heads it as a report does', () => {
        const f = pathField('Account.Owner.Email', CONTACT, { account: ACCOUNT, user: USER });
        expect(f).toMatchObject({ name: 'Account.Owner.Email', heading: 'Account: Owner: Email', type: 'email' });
        expect(pathField('account.name', CONTACT, { account: ACCOUNT }).isName).toBe(false);
    });

    it('says which object it needs next when its describe is not loaded', () => {
        expect(walkPath('Account.Owner.Email', CONTACT, {}).missing).toBe('Account');
        expect(walkPath('Account.Owner.Email', CONTACT, { account: ACCOUNT }).missing).toBe('User');
        expect(pathField('Account.Owner.Email', CONTACT, { account: ACCOUNT })).toBeNull();
    });

    it('does not reach through a lookup that can point to more than one kind of record', () => {
        expect(pathField('Who.LastName', CONTACT, {})).toBeNull();
    });
});

describe('the field lists', () => {
    it('offers the fields, then the lookups that open their record’s fields', () => {
        const [first] = pathSteps('LastName', CONTACT, {});
        expect(first.value).toBe('LastName');
        expect(first.options.map(o => o.value)).toEqual(['LastName', 'AccountId', 'WhoId', 'Account.']);
        expect(first.options[3].label).toBe('Account >');
    });

    it('shows one list per object on the way, the next empty until a field is chosen', () => {
        const steps = pathSteps('Account.', CONTACT, { account: ACCOUNT });
        expect(steps.map(s => s.value)).toEqual(['Account.', '']);
        expect(steps[1].objectLabel).toBe('Account');
        expect(steps[1].options.map(o => o.value)).toContain('Owner.');
    });

    it('matches what was saved in any case to the field’s own spelling', () => {
        const steps = pathSteps('account.industry', CONTACT, { account: ACCOUNT });
        expect(steps.map(s => s.value)).toEqual(['Account.', 'Industry']);
    });

    it('stops offering lookups after the last one a column may reach through', () => {
        expect(MAX_HOPS).toBe(5);
        const self = {
            name: 'Account',
            label: 'Account',
            fields: [lookup('ParentId', 'Parent', 'Parent Account ID', 'Account')]
        };
        const steps = pathSteps('Parent.Parent.Parent.Parent.Parent.Name', self, { account: self });
        expect(steps).toHaveLength(6);
        expect(steps[4].options.map(o => o.value)).toContain('Parent.');
        expect(steps[5].options.map(o => o.value)).not.toContain('Parent.');
    });
});
