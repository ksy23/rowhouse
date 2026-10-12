/**
 * rowhouseDevHost — DEVELOPMENT ONLY. Never packaged.
 *
 * Puts gridApp on a development org's "Rowhouse (dev)" tab. The configuration is
 * Consignments unless the URL names another, which is how the benchmark
 * switches grids without a page per configuration:
 *
 *   /lightning/n/Rowhouse_Dev?c__grid=Freight_Bills_20
 *
 * c__record stands in for the record page's recordId, so a grid with a
 * Record Page Field can be tried without activating a record page:
 *
 *   /lightning/n/Rowhouse_Dev?c__grid=Account_Contacts&c__record=001...
 *
 * gridApp itself can be placed on App, Record and Home pages (HR-2 as
 * amended); a Lightning tab needs the lightning__Tab target, which gridApp
 * does not have, so the dev tab keeps this host.
 *
 * The grid is placed only once the page reference is known:
 * before, it opened Consignments and then, when the URL named another grid,
 * opened that one too: two loads for one click.
 */
import { LightningElement, api, wire } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';

export default class RowhouseDevHost extends LightningElement {
    @api gridName = 'Consignments';
    urlGrid = null;
    recordId = null;
    pageKnown = false;

    @wire(CurrentPageReference)
    setPageReference(ref) {
        this.urlGrid = (ref && ref.state && ref.state.c__grid) || null;
        this.recordId = (ref && ref.state && ref.state.c__record) || null;
        this.pageKnown = true;
    }

    get configName() {
        return this.urlGrid || this.gridName;
    }
}
