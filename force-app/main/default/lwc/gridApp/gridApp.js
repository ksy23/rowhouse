/**
 * gridApp — the one exposed component (HR-2): the grid an admin places on an
 * App, Record or Home page.
 *
 * TWO PUBLIC MEMBERS (HR-2)
 *   configName — the DeveloperName of a Grid Configuration record, set by the
 *   admin in Lightning App Builder.
 *   recordId — set by Lightning itself on a record page: the page's record.
 *   It is not a property in Lightning App Builder. With a Record Page Field
 *   on the configuration, the grid shows only the records related to it.
 * Every @api member of an exposed component is permanent once released, so
 * there are exactly these two.
 *
 * Everything else lives in c/gridView, which is not exposed: a grid's loading,
 * editing, saving, mass actions, import, grouping and export. gridApp shows one
 * top-level gridView. A child table under a row is a gridView too, with
 * a parent record, which is why the grid itself is not in this component: its
 * extra inputs would otherwise become permanent here.
 */
import { LightningElement, api } from 'lwc';

export default class GridApp extends LightningElement {
    _configName = '';
    _recordId = '';

    @api
    get configName() {
        return this._configName;
    }
    set configName(value) {
        this._configName = typeof value === 'string' ? value.trim() : '';
    }

    @api
    get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        this._recordId = typeof value === 'string' ? value.trim() : '';
    }
}
