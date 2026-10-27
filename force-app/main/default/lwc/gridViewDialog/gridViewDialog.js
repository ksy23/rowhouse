/**
 * gridViewDialog — a saved view's dialogs, as a list view's are, word for
 * word but "view" for "list view":
 *   new      New View: View Name, and Who sees this view?
 *   clone    Clone View: the same, the name "Copy of …"
 *   saveAs   Save As: the same, for the view as it is shown now
 *   rename   Rename View: View Name; who sees it, as text
 *   sharing  Sharing Settings: Who sees this view?
 *   delete   Delete: are you sure?
 * Who sees this view: "Only I can see this view", "All users can see this
 * view" and "Share view with groups of users", which searches roles and
 * public groups (GridController.viewGroupTypes, searchViewGroups) and shows
 * each one picked as a pill. The two sharing choices need Salesforce's Manage
 * Public List Views (canShare); without it only the first is offered.
 *
 * The SLDS modal blueprint, as the other dialogs: focus starts on the first
 * field (Cancel, for Delete), stays in the dialog, and Escape cancels. Save
 * waits while the grid saves (busy), and an error from the server shows
 * under the fields.
 *
 * INPUTS (plain values, HR-28)
 *   mode       new, clone, saveAs, rename, sharing, delete
 *   name       the name to start with
 *   sharing    who sees the view now: me, all, groups
 *   groups     the groups it is shared with, [{ id, name, type, typeLabel }]
 *   canShare   the user holds Manage Public List Views
 *   gridTitle  the grid's title, for All users' help
 *   busy, error
 * EVENTS OUT
 *   save    { name, shareMode, groupIds }   (rename: name only; sharing: shareMode and groupIds)
 *   delete
 *   cancel
 */
import { LightningElement, api } from 'lwc';
import viewGroupTypes from '@salesforce/apex/GridController.viewGroupTypes';
import searchViewGroups from '@salesforce/apex/GridController.searchViewGroups';
import { MAX_NAME, ONLY_ME, ALL_USERS, WITH_GROUPS } from 'c/gridSavedViews';

/** ms after the last key before the groups are searched. */
export const SEARCH_DELAY_MS = 300;

const TITLES = {
    new: 'New View',
    clone: 'Clone View',
    saveAs: 'Save As',
    rename: 'Rename View',
    sharing: 'Sharing Settings',
    delete: 'Delete'
};

const SHARING_TEXT = {
    [ONLY_ME]: 'Only I can see this view',
    [ALL_USERS]: 'All users can see this view',
    [WITH_GROUPS]: 'Share view with groups of users'
};

const messageOf = e => (e && e.body && e.body.message) || (e && e.message) || 'The groups could not be searched.';

export default class GridViewDialog extends LightningElement {
    @api mode = 'new';
    @api canShare = false;
    @api gridTitle = '';
    @api busy = false;
    @api error = '';

    _name = '';
    _sharing = ONLY_ME;
    _groups = [];

    /** The kinds of group, [{ value, label }], once read; the one chosen. */
    types = null;
    type = null;
    term = '';
    found = [];
    searchError = '';
    nameProblem = '';

    // Non-reactive (HR-20).
    _state = { timer: null, searchToken: 0 };
    _layout = { focused: false };

    @api
    get name() {
        return this._name;
    }
    set name(value) {
        this._name = value ? String(value) : '';
    }

    @api
    get sharing() {
        return this._sharing;
    }
    set sharing(value) {
        this._sharing = [ONLY_ME, ALL_USERS, WITH_GROUPS].includes(value) ? value : ONLY_ME;
    }

    @api
    get groups() {
        return this._groups;
    }
    set groups(value) {
        this._groups = Array.isArray(value) ? value : [];
    }

    connectedCallback() {
        if (this._sharing === WITH_GROUPS && this.canShare) this.loadTypes();
    }

    disconnectedCallback() {
        clearTimeout(this._state.timer);
        this._state.searchToken++;
    }

    renderedCallback() {
        if (this._layout.focused) return;
        const first = this.template.querySelector(this.isDelete ? '.rh-view-cancel' : '[data-first]');
        if (first) {
            this._layout.focused = true;
            first.focus();
        }
    }

    get title() {
        return TITLES[this.mode] || TITLES.new;
    }

    get isDelete() {
        return this.mode === 'delete';
    }

    get isRename() {
        return this.mode === 'rename';
    }

    get showName() {
        return this.mode !== 'sharing' && this.mode !== 'delete';
    }

    get showSharing() {
        return this.mode !== 'rename' && this.mode !== 'delete';
    }

    /** Rename says who sees the view, as text: Sharing Settings changes it. */
    get sharingText() {
        if (this._sharing === WITH_GROUPS) {
            const n = this._groups.length;
            return `Shared with ${n} ${n === 1 ? 'group' : 'groups'} of users`;
        }
        return SHARING_TEXT[this._sharing];
    }

    get nameClass() {
        return 'slds-form-element' + (this.nameProblem ? ' slds-has-error' : '');
    }

    get maxName() {
        return MAX_NAME;
    }

    get saveLabel() {
        return this.isDelete ? 'Delete' : 'Save';
    }

    /** The three choices, or only the first without Manage Public List Views. */
    get sharingOptions() {
        const values = this.canShare ? [ONLY_ME, ALL_USERS, WITH_GROUPS] : [ONLY_ME];
        return values.map((value, i) => ({
            value,
            id: 'share-' + value,
            label: SHARING_TEXT[value],
            checked: this._sharing === value,
            help:
                value === ALL_USERS
                    ? `Everyone who can open ${this.gridTitle || 'this grid'}.`
                    : value === WITH_GROUPS
                      ? "If you don't choose any groups, only you can see this view."
                      : '',
            first: i === 0 && !this.showName
        }));
    }

    get sharesWithGroups() {
        return this.canShare && this._sharing === WITH_GROUPS;
    }

    get noShareText() {
        return this.canShare
            ? ''
            : 'Only you can see this view. Sharing a view needs the Manage Public List Views permission.';
    }

    get typeOptions() {
        return (this.types || []).map(t => ({ ...t, selected: t.value === this.type }));
    }

    get searchPlaceholder() {
        const t = (this.types || []).find(x => x.value === this.type);
        return `Search ${t ? t.label : 'groups'}...`;
    }

    get foundItems() {
        const picked = new Set(this._groups.map(g => g.id));
        return this.found.filter(g => !picked.has(g.id)).map(g => ({ ...g, key: g.id }));
    }

    get hasFound() {
        return this.foundItems.length > 0;
    }

    get pickedGroups() {
        return this._groups.map(g => ({ ...g, key: g.id, removeLabel: `Remove ${g.name}` }));
    }

    get groupCountText() {
        const n = this._groups.length;
        return `Shared with ${n} ${n === 1 ? 'group' : 'groups'} of users.`;
    }

    get saveDisabled() {
        return this.busy;
    }

    async loadTypes() {
        if (this.types) return;
        try {
            const types = (await viewGroupTypes()) || [];
            this.types = types;
            this.type = types.length ? types[0].value : null;
        } catch (e) {
            this.types = [];
            this.searchError = messageOf(e);
        }
    }

    handleNameChange(event) {
        this._name = String((event.target && event.target.value) || '');
        if (this.nameProblem && this._name.trim()) this.nameProblem = '';
    }

    handleSharingChange(event) {
        const value = event.target && event.target.value;
        if (!value) return;
        this._sharing = value;
        if (value === WITH_GROUPS) this.loadTypes();
    }

    handleTypeChange(event) {
        this.type = event.target.value;
        this.found = [];
        if (this.term) this.search();
    }

    handleTermChange(event) {
        this.term = String((event.target && event.target.value) || '');
        clearTimeout(this._state.timer);
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- debounce typing; cleared on disconnect
        this._state.timer = setTimeout(() => this.search(), SEARCH_DELAY_MS);
    }

    async search() {
        const token = ++this._state.searchToken;
        const term = this.term.trim();
        if (!term || !this.type) {
            this.found = [];
            return;
        }
        try {
            const found = (await searchViewGroups({ type: this.type, term })) || [];
            if (token !== this._state.searchToken) return;
            this.found = found;
            this.searchError = '';
        } catch (e) {
            if (token !== this._state.searchToken) return;
            this.found = [];
            this.searchError = messageOf(e);
        }
    }

    handlePick(event) {
        const id = event.currentTarget.dataset.id;
        const g = this.found.find(x => x.id === id);
        if (!g || this._groups.some(x => x.id === id)) return;
        this._groups = [...this._groups, { id: g.id, name: g.name, type: g.type, typeLabel: g.typeLabel }];
        this.term = '';
        this.found = [];
        const box = this.template.querySelector('.rh-view-group-search');
        if (box) box.focus();
    }

    handleUnpick(event) {
        const id = event.currentTarget.dataset.id;
        this._groups = this._groups.filter(g => g.id !== id);
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.dispatchEvent(new CustomEvent('cancel'));
        }
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }

    handleSave() {
        if (this.busy) return;
        if (this.isDelete) {
            this.dispatchEvent(new CustomEvent('delete'));
            return;
        }
        const name = this._name.trim();
        if (this.showName && !name) {
            this.nameProblem = 'Enter a view name.';
            const box = this.template.querySelector('[data-first]');
            if (box) box.focus();
            return;
        }
        const detail = {};
        if (this.showName) detail.name = name;
        if (this.showSharing) {
            detail.shareMode = this._sharing;
            detail.groupIds = this._sharing === WITH_GROUPS ? this._groups.map(g => g.id) : [];
        }
        this.dispatchEvent(new CustomEvent('save', { detail }));
    }

    /** Shift+Tab from the first control: round to the last. */
    handleGuardStart() {
        const last = this.template.querySelector('.rh-view-save');
        if (last) last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const first = this.template.querySelector('.rh-view-close');
        if (first) first.focus();
    }
}
