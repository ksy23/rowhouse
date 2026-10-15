/**
 * gridAdminHelp — the Grid Guide beside the grid editor on the Grid Admin tab.
 * It follows the editor's open tab: Grid shows the Grid Configuration,
 * Columns the Grid Column, and so on, each in a few lines drawn from the
 * Configuration reference (guide/pages/configure.html), with Open to read the
 * whole of it in the Grid Guide, in a new browser tab.
 *
 * INPUTS (plain values, HR-28)
 *   tab  the editor's open tab: grid, columns, rules, filters, actions or children
 * EVENTS OUT
 *   hide  Hide help was clicked; the editor folds the panel away
 */
import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { openGuide, guideUrl } from 'c/guideRoute';
import { namespaceOf } from 'c/gridFlowRoute';

/** Each tab's part of the Configuration reference (guide/pages/configure.html). */
export const SECTIONS = Object.freeze({
    grid: 'config',
    columns: 'column',
    rules: 'rule',
    filters: 'filter',
    actions: 'action',
    children: 'child'
});

/** The record each tab edits, as the Configuration reference names it. */
const TITLES = Object.freeze({
    grid: 'Grid Configuration',
    columns: 'Grid Column',
    rules: 'Grid Display Rule',
    filters: 'Grid Filter',
    actions: 'Grid Action',
    children: 'Grid Child Table'
});

export default class GridAdminHelp extends NavigationMixin(LightningElement) {
    _tab = 'grid';

    @api
    get tab() {
        return this._tab;
    }
    set tab(value) {
        this._tab = SECTIONS[value] ? value : 'grid';
    }

    get isGrid() {
        return this._tab === 'grid';
    }

    get isColumns() {
        return this._tab === 'columns';
    }

    get isRules() {
        return this._tab === 'rules';
    }

    get isFilters() {
        return this._tab === 'filters';
    }

    get isActions() {
        return this._tab === 'actions';
    }

    get isChildren() {
        return this._tab === 'children';
    }

    get title() {
        return TITLES[this._tab];
    }

    get section() {
        return SECTIONS[this._tab];
    }

    get openUrl() {
        return guideUrl(namespaceOf(this.template.host), 'configure', this.section);
    }

    /** This tab's part of the Configuration reference, in a new browser tab, so the grid being built stays as it is. */
    handleOpen(event) {
        if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openGuide(this, namespaceOf(this.template.host), 'configure', this.section).catch(() => {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'The Grid Guide did not open',
                    message: 'Open the Grid Guide tab in the Rowhouse app.',
                    variant: 'warning'
                })
            );
        });
    }

    handleHide() {
        this.dispatchEvent(new CustomEvent('hide'));
    }
}
