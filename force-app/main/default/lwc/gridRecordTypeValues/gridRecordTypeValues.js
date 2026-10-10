/**
 * gridRecordTypeValues — the picklist values one record type allows, read
 * from Salesforce (lightning/uiObjectInfoApi getPicklistValuesByRecordType)
 * and handed to the grid. It draws nothing: the grid places one for each
 * record type among its rows.
 *
 * INPUTS (plain values, HR-28)
 *   objectApiName   the grid's object
 *   recordTypeId    the record type
 *
 * EVENT
 *   values   { recordTypeId, fields: { [field, lower case]: [values] } }
 *
 * If Salesforce cannot say (no access, offline), nothing is sent, and the
 * row's picklists offer every value of the field, as they did before.
 */
import { LightningElement, api, wire } from 'lwc';
import { getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import { recordTypeValues } from 'c/gridFields';

export default class GridRecordTypeValues extends LightningElement {
    @api objectApiName;
    @api recordTypeId;

    @wire(getPicklistValuesByRecordType, { objectApiName: '$objectApiName', recordTypeId: '$recordTypeId' })
    wiredValues({ data }) {
        if (!data) return;
        this.dispatchEvent(
            new CustomEvent('values', {
                detail: { recordTypeId: this.recordTypeId, fields: recordTypeValues(data) }
            })
        );
    }
}
