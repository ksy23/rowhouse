/**
 * The reader of one record type's picklist values: it asks Salesforce for
 * the grid's object and the record type, and hands on what it answers.
 */
/* eslint-disable @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit, error and last config */
import { createElement } from 'lwc';
import GridRecordTypeValues from 'c/gridRecordTypeValues';
import { getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';

const RT = '012000000000001AAA';

function mount() {
    const el = createElement('c-grid-record-type-values', { is: GridRecordTypeValues });
    el.objectApiName = 'Inspection__c';
    el.recordTypeId = RT;
    const heard = [];
    el.addEventListener('values', e => heard.push(e.detail));
    document.body.appendChild(el);
    return { el, heard };
}

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('gridRecordTypeValues', () => {
    it('asks for the record type of the object, and hands on its values by field', async () => {
        const { heard } = mount();
        await Promise.resolve();
        expect(getPicklistValuesByRecordType.getLastConfig()).toEqual({
            objectApiName: 'Inspection__c',
            recordTypeId: RT
        });
        getPicklistValuesByRecordType.emit({
            picklistFieldValues: { Status__c: { values: [{ value: 'New' }, { value: 'Archived' }] } }
        });
        await Promise.resolve();
        expect(heard).toEqual([{ recordTypeId: RT, fields: { status__c: ['New', 'Archived'] } }]);
    });

    it('says nothing when Salesforce cannot answer', async () => {
        const { heard, el } = mount();
        getPicklistValuesByRecordType.error();
        await Promise.resolve();
        expect(heard).toEqual([]);
        expect(el.shadowRoot.childNodes.length).toBe(0);
    });
});
