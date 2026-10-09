/**
 * Salesforce's New form over the grid: behind a lookup's New item, and behind
 * the grid's New button when a new record cannot be a row of the grid. Built
 * from Salesforce's own description of the form (getRecordCreateDefaults),
 * with a record type step when the user has more than one to choose from.
 */
/* eslint-disable @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapters' emit and error */
import { createElement } from 'lwc';
import GridNewRecord, { availableRecordTypes, formSections } from 'c/gridNewRecord';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { getRecordCreateDefaults } from 'lightning/uiRecordApi';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const mount = async props => {
    el = createElement('c-grid-new-record', { is: GridNewRecord });
    Object.assign(el, props);
    events = [];
    el.addEventListener('created', e => events.push({ name: 'created', detail: e.detail }));
    el.addEventListener('cancel', () => events.push({ name: 'cancel' }));
    document.body.appendChild(el);
    await flush();
};

const MASTER = '012000000000000AAA';
const SALES = '012hk0000000001AAA';
const SUPPORT = '012hk0000000002AAA';
const ONE_TYPE = {
    defaultRecordTypeId: MASTER,
    recordTypeInfos: { [MASTER]: { recordTypeId: MASTER, name: 'Master', available: true, master: true } }
};
const TWO_TYPES = {
    defaultRecordTypeId: SUPPORT,
    recordTypeInfos: {
        [MASTER]: { recordTypeId: MASTER, name: 'Master', available: true, master: true },
        [SUPPORT]: { recordTypeId: SUPPORT, name: 'Support', available: true, defaultRecordTypeMapping: true },
        [SALES]: { recordTypeId: SALES, name: 'Sales', available: true },
        '012hk0000000003AAA': { recordTypeId: '012hk0000000003AAA', name: 'Hidden', available: false }
    }
};
const field = (apiName, label, extra = {}) => ({
    editableForNew: true,
    label,
    required: false,
    layoutComponents: [{ componentType: 'Field', apiName }],
    ...extra
});
const DEFAULTS = {
    layout: {
        sections: [
            {
                id: 'info',
                heading: 'Contact Information',
                useHeading: true,
                columns: 2,
                layoutRows: [
                    { layoutItems: [field('Name', 'Name', { required: true }), field('AccountId', 'Account Name')] },
                    { layoutItems: [field('Title', 'Title'), { editableForNew: false, layoutComponents: [] }] },
                    { layoutItems: [field('LeadSource', 'Lead Source')] }
                ]
            },
            {
                id: 'system',
                heading: 'System Information',
                useHeading: true,
                columns: 2,
                layoutRows: [
                    {
                        layoutItems: [
                            {
                                editableForNew: false,
                                label: 'Created By',
                                layoutComponents: [{ componentType: 'Field', apiName: 'CreatedById' }]
                            }
                        ]
                    }
                ]
            }
        ]
    },
    record: { fields: { LeadSource: { value: 'Web' }, Title: { value: null } } }
};

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('gridNewRecord', () => {
    it('is a labelled dialog that says where the new record goes', async () => {
        await mount({ objectApiName: 'Account', objectLabel: 'Account', fieldLabel: 'Related Account' });
        expect($('section').getAttribute('role')).toBe('dialog');
        expect($('section').getAttribute('aria-modal')).toBe('true');
        expect($('h1').textContent).toBe('New Account');
        expect($('.rh-new-record-where').textContent).toBe(
            'When it is saved, it goes in Related Account as an unsaved change.'
        );
        el.fieldLabel = '';
        await flush();
        expect($('.rh-new-record-where').textContent).toBe('When it is saved, it is added to the grid.');
    });

    it("shows Salesforce's New form for the object: its layout's sections, defaults, required fields and presets", async () => {
        await mount({ objectApiName: 'Contact', objectLabel: 'Contact', presets: { AccountId: '001000000000001AAA' } });
        getObjectInfo.emit(ONE_TYPE);
        await flush();
        expect($('.rh-new-record-loading')).not.toBeNull(); // while Salesforce describes the form
        getRecordCreateDefaults.emit(DEFAULTS);
        await flush();
        expect($('.rh-new-record-loading')).toBeNull();
        const form = $('lightning-record-edit-form');
        expect(form.objectApiName).toBe('Contact');
        expect(form.recordTypeId).toBe(MASTER);
        // The section with nothing a new record can be given is left out.
        expect($$('.rh-new-record-heading').map(h => h.textContent)).toEqual(['Contact Information']);
        const inputs = $$('lightning-input-field');
        expect(inputs.map(i => i.fieldName)).toEqual(['Name', 'AccountId', 'Title', 'LeadSource']);
        expect(inputs[0].required).toBe(true);
        expect(inputs[1].value).toBe('001000000000001AAA'); // the grid's parent, filled in
        expect(inputs[3].value).toBe('Web'); // Salesforce's default
        // The gap in a row keeps the columns in line.
        expect($$('.rh-new-record-cell')).toHaveLength(5);
        expect($('lightning-record-form')).toBeNull();
    });

    it('asks for the record type first when the user has more than one, the default chosen', async () => {
        await mount({ objectApiName: 'Case', objectLabel: 'Case' });
        getObjectInfo.emit(TWO_TYPES);
        await flush();
        const group = $('lightning-radio-group');
        expect(group.label).toBe('Select a record type');
        expect(group.options).toEqual([
            { value: SALES, label: 'Sales' },
            { value: SUPPORT, label: 'Support' }
        ]);
        expect(group.value).toBe(SUPPORT);
        expect($('lightning-record-edit-form')).toBeNull();
        group.dispatchEvent(new CustomEvent('change', { detail: { value: SALES } }));
        $('.rh-new-record-next').click();
        await flush();
        getRecordCreateDefaults.emit(DEFAULTS);
        await flush();
        expect($('lightning-radio-group')).toBeNull();
        expect($('lightning-record-edit-form').recordTypeId).toBe(SALES);
    });

    it('checks the fields, then saves, and says the new record Id', async () => {
        await mount({ objectApiName: 'Contact', objectLabel: 'Contact' });
        getObjectInfo.emit(ONE_TYPE);
        await flush();
        getRecordCreateDefaults.emit(DEFAULTS);
        await flush();
        const form = $('lightning-record-edit-form');
        form.submit = jest.fn();
        const inputs = $$('lightning-input-field');
        inputs.forEach(i => {
            i.reportValidity = jest.fn(() => true);
        });
        inputs[0].reportValidity = jest.fn(() => false);
        $('.rh-new-record-save').click();
        expect(form.submit).not.toHaveBeenCalled(); // a required field is blank
        inputs[0].reportValidity = jest.fn(() => true);
        $('.rh-new-record-save').click();
        expect(form.submit).toHaveBeenCalledTimes(1);
        await flush();
        expect($('.rh-new-record-save').disabled).toBe(true); // while it saves
        form.dispatchEvent(new CustomEvent('error'));
        await flush();
        expect($('.rh-new-record-save').disabled).toBe(false); // Salesforce's message shows; try again
        form.dispatchEvent(new CustomEvent('success', { detail: { id: '003000000000001AAA' } }));
        expect(events).toEqual([{ name: 'created', detail: { id: '003000000000001AAA' } }]);
    });

    it("falls back to the object's full layout when Salesforce cannot describe the form", async () => {
        await mount({ objectApiName: 'Account', objectLabel: 'Account' });
        getObjectInfo.error();
        await flush();
        const form = $('lightning-record-form');
        expect(form.objectApiName).toBe('Account');
        expect(form.layoutType).toBe('Full');
        expect(form.mode).toBe('edit');
        form.dispatchEvent(new CustomEvent('success', { detail: { id: '001000000000001AAA' } }));
        expect(events).toEqual([{ name: 'created', detail: { id: '001000000000001AAA' } }]);
    });

    it('cancels from the Cancel button, the close button and Escape', async () => {
        await mount({ objectApiName: 'Contact', objectLabel: 'Contact' });
        getObjectInfo.emit(ONE_TYPE);
        await flush();
        getRecordCreateDefaults.emit(DEFAULTS);
        await flush();
        $('.rh-new-record-cancel').click();
        $('.rh-new-record-close').click();
        $('section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(events).toEqual([{ name: 'cancel' }, { name: 'cancel' }, { name: 'cancel' }]);
    });

    it('is accessible on each step', async () => {
        await mount({ objectApiName: 'Case', objectLabel: 'Case' });
        getObjectInfo.emit(TWO_TYPES);
        await flush();
        await expect(el).toBeAccessible();
        $('.rh-new-record-next').click();
        await flush();
        getRecordCreateDefaults.emit(DEFAULTS);
        await flush();
        await expect(el).toBeAccessible();
    });
});

describe('the pure helpers', () => {
    it('lists the available record types but the master, by name, marking the default', () => {
        expect(availableRecordTypes(TWO_TYPES)).toEqual([
            { value: SALES, label: 'Sales', isDefault: false },
            { value: SUPPORT, label: 'Support', isDefault: true }
        ]);
        expect(availableRecordTypes(ONE_TYPE)).toEqual([]);
        expect(availableRecordTypes(null)).toEqual([]);
    });

    it('reads the layout into sections of fields, presets over defaults', () => {
        const sections = formSections(DEFAULTS, { LeadSource: 'Phone' });
        expect(sections).toHaveLength(1);
        expect(sections[0].heading).toBe('Contact Information');
        expect(sections[0].items.map(i => i.fields.map(f => f.name).join())).toEqual([
            'Name',
            'AccountId',
            'Title',
            '',
            'LeadSource'
        ]);
        expect(sections[0].items[4].fields[0].value).toBe('Phone');
        expect(sections[0].items[0].fields[0].required).toBe(true);
        // An address is one item of several fields, street first.
        const address = formSections(
            {
                layout: {
                    sections: [
                        {
                            columns: 2,
                            layoutRows: [
                                {
                                    layoutItems: [
                                        {
                                            editableForNew: true,
                                            required: false,
                                            label: 'Mailing Address',
                                            layoutComponents: [
                                                { componentType: 'Field', apiName: 'MailingStreet' },
                                                { componentType: 'Field', apiName: 'MailingCity' },
                                                { componentType: 'Field', apiName: 'MailingPostalCode' }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                record: { fields: { MailingCity: { value: 'Concord' } } }
            },
            null
        );
        expect(address[0].items[0].fields.map(f => f.name)).toEqual([
            'MailingStreet',
            'MailingCity',
            'MailingPostalCode'
        ]);
        expect(address[0].items[0].fields[1].value).toBe('Concord');
        expect(formSections(null, null)).toEqual([]);
        // A required name is one item of several fields: Last Name is the part every record needs.
        const name = formSections(
            {
                layout: {
                    sections: [
                        {
                            columns: 2,
                            layoutRows: [
                                {
                                    layoutItems: [
                                        {
                                            editableForNew: true,
                                            required: true,
                                            label: 'Name',
                                            layoutComponents: [
                                                { componentType: 'Field', apiName: 'Salutation' },
                                                { componentType: 'Field', apiName: 'FirstName' },
                                                { componentType: 'Field', apiName: 'LastName' }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                objectInfos: {
                    Contact: {
                        fields: { Salutation: { required: false }, FirstName: {}, LastName: { required: true } }
                    }
                },
                record: { apiName: 'Contact', fields: {} }
            },
            null
        );
        expect(name[0].items[0].fields.map(f => `${f.name}:${f.required}`)).toEqual([
            'Salutation:false',
            'FirstName:false',
            'LastName:true'
        ]);
        const oneColumn = formSections(
            { layout: { sections: [{ columns: 1, layoutRows: [{ layoutItems: [field('Subject', 'Subject')] }] }] } },
            null
        );
        expect(oneColumn[0].items[0].cls).toContain('slds-size_1-of-1');
        expect(oneColumn[0].items[0].cls).not.toContain('medium-size');
        expect(oneColumn[0].heading).toBe('');
    });
});
