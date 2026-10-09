/**
 * gridLogRetention — on the Grid Admin tab's Settings page, how long
 * the Grid Edit Log keeps its entries: Forever, 90 days, 1 year,
 * 2 years or 7 years.
 *
 * Below the choice, three of the Grid Guide's stat cards: the period, when the
 * clean-up next runs and as whom, and the grids that log every change.
 *
 * Saving deploys the Rowhouse Setting record, as a grid is saved, and
 * schedules the nightly clean-up to run as the admin saving; Forever removes
 * it. The page then asks GridAdminController.saveStatus until the deploy has
 * finished, and reads the status again: the period, when the clean-up next
 * runs and as whom, and what it last removed.
 *
 * Saving needs Customize Application (canSave) and, for a period, the right
 * to delete log entries (canRun), since the clean-up runs as the saver.
 *
 * EVENTS OUT
 *   saved  { days }, once a save has gone through (the Grids page's card follows)
 */
import { LightningElement } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import logRetention from '@salesforce/apex/GridAdminController.logRetention';
import saveLogRetention from '@salesforce/apex/GridAdminController.saveLogRetention';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';
import LOCALE from '@salesforce/i18n/locale';
import { openGuide, guideUrl } from 'c/guideRoute';
import { namespaceOf } from 'c/gridFlowRoute';

/** Where the Grid Guide explains this setting. */
const HELP_PAGE = 'features';
const HELP_SECTION = 'audit-retention';

/** How long to wait between asking whether the save has gone through. */
export const POLL_DELAYS_MS = [1000, 1500, 2000, 3000];
/** How long to keep asking. */
export const SAVE_TIMEOUT_MS = 90000;

const delay = ms =>
    new Promise(resolve => {
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- waiting between status checks
        setTimeout(resolve, ms);
    });

function messageOf(error) {
    if (!error) return 'Unknown error.';
    const body = error.body;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    if (Array.isArray(body))
        return body
            .map(e => e && e.message)
            .filter(Boolean)
            .join(' ');
    return error.message || String(error);
}

/** A date, a time, or both, as people read them here: Oct 7, 2026 · 2:00 AM. */
function when(value, parts = { dateStyle: 'medium', timeStyle: 'short' }) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(LOCALE, parts).format(d);
}

export default class GridLogRetention extends NavigationMixin(LightningElement) {
    status = null;
    loading = true;
    loadError = null;
    /** The period chosen in the box, as its value: '' for forever, or days. */
    chosen = '';
    saving = false;
    saveError = null;

    // Non-reactive (HR-20).
    _runtime = { token: 0 };

    connectedCallback() {
        this.load();
    }

    disconnectedCallback() {
        this._runtime.token++;
    }

    async load() {
        const token = ++this._runtime.token;
        try {
            const status = await logRetention();
            if (token !== this._runtime.token) return;
            this.status = status || {};
            this.chosen = this.savedValue;
            this.loadError = null;
        } catch (e) {
            if (token === this._runtime.token) this.loadError = messageOf(e);
        } finally {
            if (token === this._runtime.token) this.loading = false;
        }
    }

    /** The saved period as the box's value. */
    get savedValue() {
        const days = this.status && this.status.days;
        return days === null || days === undefined ? '' : String(days);
    }

    get options() {
        return ((this.status && this.status.options) || []).map(o => ({ label: o.label, value: o.value }));
    }

    get canSave() {
        return Boolean(this.status && this.status.canSave);
    }

    get choiceDisabled() {
        return this.saving || !this.canSave;
    }

    get saveDisabled() {
        if (this.saving || !this.canSave) return true;
        if (this.chosen !== this.savedValue) return false;
        // The saved period again: worth saving when it starts a missing clean-up, or moves it to you.
        const s = this.status || {};
        return !(this.chosen && (!s.scheduled || s.mine === false));
    }

    get saveTitle() {
        return this.canSave
            ? 'Save how long the edit log keeps its entries'
            : 'Saving needs the Customize Application permission';
    }

    get chosenLabel() {
        const option = this.options.find(o => o.value === this.chosen);
        return option ? option.label : '';
    }

    // ---- the stat cards

    /** The period saved: Forever, 90 days, 1 year… */
    get periodFigure() {
        return (this.status && this.status.label) || 'Forever';
    }

    get periodText() {
        return this.savedValue
            ? 'Entries older than this are deleted each night, for good.'
            : 'Entries are kept forever. Nothing deletes them.';
    }

    /** When the clean-up next runs: its time, or that it is off. */
    get nextFigure() {
        const s = this.status || {};
        if (!this.savedValue) return 'Off';
        if (!s.scheduled) return 'Not scheduled';
        return when(s.nextRun, { timeStyle: 'short' }) || 'Nightly';
    }

    /** The clean-up, in a sentence: when it next runs and as whom. */
    get statusText() {
        const s = this.status || {};
        if (!this.savedValue) return 'No clean-up runs while entries are kept forever.';
        if (!s.scheduled) return 'The nightly clean-up is not scheduled.';
        const next = when(s.nextRun, { dateStyle: 'medium' });
        return (
            `The nightly clean-up${next ? `, next on ${next},` : ''} runs as ${s.runsAs || 'the admin who saved this'}.` +
            (s.mine === false && this.canSave ? ' Save to run it as you instead.' : '')
        );
    }

    get loggingGrids() {
        return (this.status && this.status.loggingGrids) || [];
    }

    get loggingFigure() {
        return new Intl.NumberFormat(LOCALE).format(this.loggingGrids.length);
    }

    /** The grids whose changes the log keeps: what the clean-up affects. */
    get loggingText() {
        const names = this.loggingGrids;
        if (!names.length)
            return "grids log every change. Select Log every change in a grid's settings for an audit trail.";
        return `${names.length === 1 ? 'grid logs' : 'grids log'} every change: ${names.join(', ')}.`;
    }

    // ---- help

    get helpUrl() {
        return guideUrl(namespaceOf(this.template.host), HELP_PAGE, HELP_SECTION);
    }

    /** The Grid Guide's part about this setting, in a new browser tab, so a choice not yet saved stays as it is. */
    handleHelp(event) {
        if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openGuide(this, namespaceOf(this.template.host), HELP_PAGE, HELP_SECTION).catch(() => {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'The Grid Guide did not open',
                    message: 'Open the Grid Guide tab in the Rowhouse app.',
                    variant: 'warning'
                })
            );
        });
    }

    get lastText() {
        const last = this.status && this.status.lastCleanup;
        if (!last) return '';
        return `Last clean-up, ${when(last.when)}: ${last.summary}.`;
    }

    /** A problem to put right, or ''. */
    get warning() {
        const s = this.status || {};
        if (this.savedValue && !s.scheduled) {
            return this.canSave
                ? 'Save again to start the nightly clean-up.'
                : 'Ask a Salesforce admin to save this again to start the nightly clean-up.';
        }
        if (this.canSave && this.chosen && s.canRun === false) {
            return 'The clean-up runs as the admin who saves this, and you cannot delete Grid Edit Log entries. Ask a System Administrator to save it.';
        }
        return '';
    }

    handleChoice(event) {
        this.chosen = event.detail.value;
        this.saveError = null;
    }

    async handleSave() {
        if (this.saveDisabled) return;
        const token = ++this._runtime.token;
        const label = this.chosenLabel;
        this.saving = true;
        this.saveError = null;
        try {
            const days = this.chosen === '' ? null : Number(this.chosen);
            const jobId = await saveLogRetention({ days });
            const outcome = await this.waitForSave(jobId, token);
            if (!outcome) return;
            if (outcome.status === 'Succeeded') {
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'Saved',
                        message:
                            days === null
                                ? 'The edit log keeps its entries forever.'
                                : `The edit log keeps its entries for ${label.toLowerCase()}.`,
                        variant: 'success'
                    })
                );
                this.saving = false;
                await this.load();
                this.dispatchEvent(new CustomEvent('saved', { detail: { days } }));
                return;
            }
            this.saveError =
                outcome.status === 'timeout'
                    ? 'The save is taking longer than usual. Reload the page in a minute to see whether it went through.'
                    : `The save did not go through. ${outcome.messages.join(' ')}`.trim();
        } catch (e) {
            if (token === this._runtime.token) this.saveError = messageOf(e);
        } finally {
            if (token === this._runtime.token) this.saving = false;
        }
    }

    /** Ask until the deploy has succeeded or failed: its outcome, { status: 'timeout' }, or null if the page closed. */
    async waitForSave(jobId, token) {
        const started = Date.now();
        for (let i = 0; ; i++) {
            // eslint-disable-next-line no-await-in-loop
            await delay(POLL_DELAYS_MS[Math.min(i, POLL_DELAYS_MS.length - 1)]);
            if (token !== this._runtime.token) return null;
            // eslint-disable-next-line no-await-in-loop
            const result = await saveStatus({ jobId });
            if (token !== this._runtime.token) return null;
            if (result && result.status && result.status !== 'pending') {
                return { status: result.status, messages: result.messages || [] };
            }
            if (Date.now() - started >= SAVE_TIMEOUT_MS) return { status: 'timeout', messages: [] };
        }
    }
}
