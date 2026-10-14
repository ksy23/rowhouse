/*
 * The stub sfdx-lwc-jest ships, with the tooltip Salesforce's own list views
 * set on this component (its Charts and Filters buttons). The shipped stub
 * leaves it out, so every grid's Charts button would warn in every suite.
 */
import { LightningElement, api } from 'lwc';

export default class ButtonIconStateful extends LightningElement {
    @api alternativeText;
    @api disabled;
    @api iconName;
    @api name;
    @api selected;
    @api size;
    @api tooltip;
    @api value;
    @api variant;
}
