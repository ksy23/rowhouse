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
 * A run that a grid in this browser tab sent (its hand-over is in the tab's
 * session storage) starts at once. Any other, a link from somewhere else or a
 * reload, asks first: the action's name, its rows, and Cancel or Run. So a
 * crafted link cannot start an admin's flow on rows someone else chose.
 *
 * When the flow finishes, the page says so in a toast and goes back to the
 * grid, which reads those rows again. Cancel goes back without waiting; the
 * grid reads the rows again then too, since a screen finished before Cancel
 * may already have saved something. The way back is only ever a Salesforce
 * page (gridFlowRoute.safeBack); without one, the browser goes back.
 *
 * Exposed only so Lightning can open it (HR-2 as amended for), with no
 * @api member.
 */
import { LightningElement, wire } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import screenFlow from '@salesforce/apex/GridController.screenFlow';
import { namespaceOf, readFlowState, forget, withDone, flowInputs, safeBack } from 'c/gridFlowRoute';

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
    /** A run from a link, not from a grid in this tab: Cancel or Run before the flow starts. */
    confirming = false;

    // Non-reactive (HR-20): the run being shown, whether it has gone back, and
    // the flow a confirmed run starts; and whether Run is still to take focus.
    _run = { key: null, value: null, done: false, flowName: '' };
    _layout = { focusRun: false };

    @wire(CurrentPageReference)
    setPageReference(ref) {
        const state = (ref && ref.state) || {};
        const key = JSON.stringify(state);
        if (key === this._run.key) return;
        this._run.key = key;
        this.start(state);
    }

    renderedCallback() {
        if (!this._layout.focusRun) return;
        const run = this.template.querySelector('.rh-flow-run');
        if (run) {
            this._layout.focusRun = false;
            run.focus();
        }
    }

    async start(state) {
        this.loading = true;
        this.error = '';
        this.flowName = '';
        this.confirming = false;
        this._run.done = false;
        this._run.flowName = '';
        this._layout.focusRun = false;
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
            if (!allowed)
                throw new Error(
                    `${action.label} does not run on ${run.on === 'selection' ? 'selected rows' : 'one row'} in this grid.`
                );
            this.title = action.label;
            this.inputs = flowInputs(action, run);
            if (run.fromThisTab) {
                this.flowName = action.flowName;
            } else {
                // Opened from a link: ask before the flow starts (Run, or Cancel).
                this._run.flowName = action.flowName;
                this._layout.focusRun = true;
                this.confirming = true;
            }
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

    /** The header's Cancel; while the page asks, its own Cancel sits beside Run. */
    get showHeaderCancel() {
        return !this.confirming;
    }

    /** Run, when the page asked first: start the flow the server named. */
    handleRun() {
        if (!this.confirming || this._run.done) return;
        this.confirming = false;
        this.flowName = this._run.flowName;
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
        this.dispatchEvent(
            new ShowToastEvent({ title: this.title, message: `${this.title}: finished.`, variant: 'success' })
        );
        this.goBack();
    }

    handleCancel() {
        this.goBack();
    }

    /**
     * To the grid's page, marked with this run's token; or back in the
     * browser's history. Only a Salesforce page is ever navigated to (safeBack).
     */
    goBack() {
        if (this._run.done) return;
        this._run.done = true;
        const run = this._run.value;
        const ns = namespaceOf(this.template.host);
        const back = run ? safeBack(withDone(run.back, ns, run.token)) : null;
        if (back) {
            this[NavigationMixin.Navigate](back);
        } else if (typeof window !== 'undefined' && window.history) {
            window.history.back();
        }
    }
}
