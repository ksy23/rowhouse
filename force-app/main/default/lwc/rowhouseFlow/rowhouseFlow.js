/**
 * rowhouseFlow — the page a grid's screen-flow action runs on.
 *
 * A grid used to run a screen flow in a dialog over itself. That put
 * lightning-flow, and with it Salesforce's whole flow engine (1.9 MB of the
 * 2.4 MB a grid downloaded on its first load), in every grid. Here it is
 * downloaded only by someone who runs a screen flow.
 *
 * The grid opens this page through Lightning's navigation (it is URL
 * addressable: /lightning/cmp/c__rowhouseFlow?c__grid=...), naming the grid,
 * the action, the rows and the page to go back to (c/gridFlowRoute). This
 * page asks the server which flow that action runs and whether this user may
 * run it (GridController.screenFlow), then runs it, as the user, with the
 * row's Id or the selected Ids as its inputs, as before.
 *
 * When the flow finishes, the page says so in a toast and goes back to the
 * grid, which reads those rows again. Cancel goes back without waiting; the
 * grid reads the rows again then too, since a screen finished before Cancel
 * may already have saved something.
 *
 * Exposed only so Lightning can open it (HR-2 as amended for), with no
 * @api member.
 */
import { LightningElement, wire } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import screenFlow from '@salesforce/apex/GridController.screenFlow';
import { namespaceOf, readFlowState, forget, withDone, flowInputs } from 'c/gridFlowRoute';

/** lightning-flow's statuses when the flow is done. */
const FINISHED = new Set(['FINISHED', 'FINISHED_SCREEN']);

function messageOf(error) {
    if (!error) return 'Unknown error.';
    const body = error.body;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    return error.message || String(error);
}

function sessionStore() {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
}

export default class RowhouseFlow extends NavigationMixin(LightningElement) {
    title = 'Screen flow';
    flowName = '';
    inputs = [];
    error = '';
    loading = true;

    // Non-reactive (HR-20): the run being shown, and whether it has gone back.
    _run = { key: null, value: null, done: false };

    @wire(CurrentPageReference)
    setPageReference(ref) {
        const state = (ref && ref.state) || {};
        const key = JSON.stringify(state);
        if (key === this._run.key) return;
        this._run.key = key;
        this.start(state);
    }

    async start(state) {
        this.loading = true;
        this.error = '';
        this.flowName = '';
        this._run.done = false;
        const store = sessionStore();
        const run = readFlowState(state, store);
        if (run.error) {
            this._run.value = null;
            this.loading = false;
            this.error = run.error;
            return;
        }
        this._run.value = run;
        forget(run.token, store);
        try {
            const action = await screenFlow({ configName: run.grid, actionName: run.action });
            if (this._run.value !== run) return; // another run started meanwhile
            const allowed = run.on === 'selection' ? action.onSelection : action.onRow;
            if (!allowed) throw new Error(`${action.label} does not run on ${run.on === 'selection' ? 'selected rows' : 'one row'} in this grid.`);
            this.title = action.label;
            this.inputs = flowInputs(action, run);
            this.flowName = action.flowName;
        } catch (e) {
            if (this._run.value !== run) return;
            this.error = messageOf(e);
        } finally {
            if (this._run.value === run) this.loading = false;
        }
    }

    get showFlow() {
        return Boolean(this.flowName) && !this.error;
    }

    get rowsText() {
        const run = this._run.value;
        if (!run || this.error) return '';
        const n = run.ids.length;
        return run.on === 'selection' ? `On ${n} selected ${n === 1 ? 'row' : 'rows'}` : 'On one row';
    }

    /** The flow says it is done once: say so, and go back to the grid. */
    handleStatusChange(event) {
        const status = event.detail && event.detail.status;
        if (!FINISHED.has(status) || this._run.done) return;
        this.dispatchEvent(new ShowToastEvent({ title: this.title, message: `${this.title}: finished.`, variant: 'success' }));
        this.goBack();
    }

    handleCancel() {
        this.goBack();
    }

    /** To the grid's page, marked with this run's token; or back in the browser's history. */
    goBack() {
        if (this._run.done) return;
        this._run.done = true;
        const run = this._run.value;
        const ns = namespaceOf(this.template.host);
        const back = run ? withDone(run.back, ns, run.token) : null;
        if (back) {
            this[NavigationMixin.Navigate](back);
        } else if (typeof window !== 'undefined' && window.history) {
            window.history.back();
        }
    }
}
