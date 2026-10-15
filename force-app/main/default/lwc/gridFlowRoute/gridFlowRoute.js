/**
 * gridFlowRoute — how a grid hands a screen-flow action to the page that runs
 * it, and how that page hands back. Plain functions over plain objects
 * (HR-28); the storage they use is passed in, so tests give their own.
 *
 * WHY A PAGE
 * lightning-flow brings Salesforce's flow engine with it: 1.9 MB of the 2.4 MB
 * a grid downloaded on its first load, measured, for every grid,
 * whether it had a screen flow or not. On its own page (c/rowhouseFlow), only
 * someone who runs a flow downloads it.
 *
 * THE HAND-OVER
 * The page reference names the grid, the action and whether it runs on one
 * row or on a selection; the page asks the server which flow that is
 * (GridController.screenFlow), so the address never chooses a flow. The rows'
 * Ids and the page to go back to are kept in the tab's session storage under
 * a random token that the address carries; up to IDS_IN_URL Ids also travel in
 * the address. Only a run whose token this tab kept came from a grid in this
 * tab: the page starts that one at once, and asks first for any other (a link
 * from somewhere else, or a reload after the entry was read). With no session
 * storage, the address carries the Ids and the way back, as long as there are
 * at most IDS_IN_URL Ids. State keys carry the package's namespace (c__
 * unmanaged, rowhouse__ managed), as Lightning requires.
 *
 * THE WAY BACK
 * When the flow finishes, or is left, the page goes back to the grid's page
 * with one more state key, flowDone, set to a token the grid chose: the grid,
 * if it is the same one, reads that action's rows again. Only a Salesforce
 * page of one of BACK_TYPES is ever a way back, wherever it was read from
 * (safeBack): never a web address, so a crafted link cannot send the user to
 * another site.
 *
 * QUICK ACTIONS
 * A quick action opens in Salesforce's own window, over the grid's page, at
 * the address Lightning itself shows for one (quickActionUrl): the action as
 * Object.Name or Global.Name, the record, and the grid's page as the
 * background to come back to. Salesforce's window applies the user's own
 * access. The page underneath stays as it was and is not told when the window
 * closes; only the address changes, to QUICK_PATH and back (measured), so the
 * grid watches it (isQuickActionPath). Not in documentation: what Lightning
 * shows, measured.
 */

import LOGO_URL from '@salesforce/resourceUrl/RowhouseLogo';

/** The page's component name, without its namespace. */
export const FLOW_PAGE = 'rowhouseFlow';
/** Ids that travel in the address; more go by session storage. */
export const IDS_IN_URL = 20;
/** Session storage keys start with this. */
export const STORE_PREFIX = 'rowhouse.flow.';

const ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

/**
 * The package's namespace from the address of its own static resource, the
 * logo: /resource/1700000000000/rowhouse__RowhouseLogo in the package,
 * /resource/1700000000000/RowhouseLogo in an org built from source
 * (measured). Blank when there is none.
 *
 * Not a schema import of a Grid Configuration: a Custom Metadata type
 * compiles and deploys there, but the package then fails to install.
 */
export function packageNamespace(resourceUrl) {
    const match = /(?:^|\/)([A-Za-z](?:[A-Za-z0-9]|_(?=[A-Za-z0-9]))*)__RowhouseLogo(?:[/?#]|$)/.exec(
        String(resourceUrl || '')
    );
    return match ? match[1] : '';
}

const PACKAGE_NS = packageNamespace(LOGO_URL);

/**
 * The namespace a component runs in: "c", or the package's. Only the
 * component Lightning places on a page carries the namespace in its tag
 * (rowhouse-rowhouse-guide); a component rendered from the package's own
 * template is tagged c-guide-page-tutorials even in the package (measured).
 * So the logo's address decides, and the element only when it names none.
 */
export function namespaceOf(host) {
    if (PACKAGE_NS) {
        return PACKAGE_NS;
    }
    const tag = host && host.tagName ? String(host.tagName).toLowerCase() : '';
    const dash = tag.indexOf('-');
    return dash > 0 ? tag.slice(0, dash) : 'c';
}

/** A random token for a hand-over and its way back. */
export function newToken() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * The kinds of page the flow page may go back to: Salesforce's own pages in
 * this org. Never standard__webPage (any address on the web),
 * standard__component (any component, with any state), an Experience Cloud
 * page (comm__*) or a Knowledge article: a way back can come from the
 * address, and a crafted link must not send the user somewhere else.
 */
export const BACK_TYPES = Object.freeze([
    'standard__navItemPage',
    'standard__recordPage',
    'standard__objectPage',
    'standard__namedPage',
    'standard__app',
    'standard__recordRelationshipPage'
]);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A way back the flow page may follow: a plain copy of a page reference of one
 * of BACK_TYPES, with attributes and state that are plain objects; else null.
 * An app page's pageRef, which opens a page inside the app, must pass the same
 * check. Whatever it was read from: the address, session storage or the grid.
 */
export function safeBack(ref, depth = 0) {
    if (!isObject(ref) || typeof ref.type !== 'string' || !BACK_TYPES.includes(ref.type)) return null;
    const attributes = ref.attributes === undefined || ref.attributes === null ? {} : ref.attributes;
    const state = ref.state === undefined || ref.state === null ? {} : ref.state;
    if (!isObject(attributes) || !isObject(state)) return null;
    const copy = { type: ref.type, attributes: { ...attributes }, state: { ...state } };
    if (copy.attributes.pageRef !== undefined) {
        const inner = depth < 1 && ref.type === 'standard__app' ? safeBack(copy.attributes.pageRef, depth + 1) : null;
        if (!inner) return null;
        copy.attributes.pageRef = inner;
    }
    return copy;
}

/**
 * A page reference to keep as the way back: plain, and without an earlier
 * flowDone marker, so it does not say a flow finished that did not.
 */
export function backRef(ref, ns) {
    if (!ref || !ref.type) return null;
    const state = { ...(ref.state || {}) };
    delete state[`${ns}__flowDone`];
    return { type: ref.type, attributes: { ...(ref.attributes || {}) }, state };
}

/** Keep a hand-over in the tab's session storage: whether it was kept. */
function keep(storage, token, entry) {
    try {
        storage.setItem(STORE_PREFIX + token, JSON.stringify(entry));
        return true;
    } catch {
        return false; // no storage, or it is full
    }
}

/** What this tab kept for a hand-over: { ids, back }, or null. */
function kept(storage, token) {
    if (!storage || !token) return null;
    try {
        const entry = JSON.parse(storage.getItem(STORE_PREFIX + token) || 'null');
        return isObject(entry) && Array.isArray(entry.ids) ? entry : null;
    } catch {
        return null;
    }
}

/**
 * The page reference that opens the flow page. `run` is { grid, action, on,
 * ids, back, token }; `storage` is the tab's session storage, or null. The Ids
 * and the way back are kept in the storage under the token, and up to
 * IDS_IN_URL Ids also go in the address. With no storage the address carries
 * them; null when there are too many Ids for it.
 */
export function flowPageRef(ns, run, storage) {
    const ids = (run.ids || []).filter(id => typeof id === 'string' && ID_RE.test(id));
    const back = safeBack(run.back);
    const state = {
        [`${ns}__grid`]: run.grid,
        [`${ns}__action`]: run.action,
        [`${ns}__on`]: run.on === 'selection' ? 'selection' : 'row',
        [`${ns}__token`]: run.token
    };
    if (ids.length <= IDS_IN_URL) state[`${ns}__ids`] = ids.join(',');
    const ref = { type: 'standard__component', attributes: { componentName: `${ns}__${FLOW_PAGE}` }, state };
    if (keep(storage, run.token, { ids, back })) return ref;
    if (ids.length > IDS_IN_URL) return null; // no storage, and too many Ids for the address
    if (back) state[`${ns}__back`] = JSON.stringify(back);
    return ref;
}

/**
 * What the flow page was asked to run, from its page reference's state:
 * { grid, action, on, ids, back, token, fromThisTab }, or { error } in words
 * for the user. fromThisTab is true only when this tab's session storage kept
 * the token's hand-over, so a grid in this tab sent it; the Ids and the way
 * back then come from there. Otherwise they come from the address.
 */
export function readFlowState(state, storage) {
    const s = state || {};
    const pick = name => {
        const key = Object.keys(s).find(k => k.endsWith(`__${name}`));
        return key ? s[key] : undefined;
    };
    const grid = pick('grid');
    const action = pick('action');
    const token = pick('token') || '';
    if (!grid || !action)
        return {
            error: "This page runs a grid's screen flow, but it was not told which. Go back to the grid and run it from there."
        };
    const entry = kept(storage, token);
    let ids = null;
    let back = null;
    if (entry) {
        ids = entry.ids;
        back = safeBack(entry.back);
    } else {
        const inUrl = pick('ids');
        if (typeof inUrl !== 'string') {
            return {
                error: 'The rows this flow was to run on were not found in this browser tab. Go back to the grid and run it again.'
            };
        }
        ids = inUrl.split(',').filter(Boolean);
        back = safeBack(parseJson(pick('back')));
    }
    ids = ids.filter(id => typeof id === 'string' && ID_RE.test(id));
    if (!ids.length)
        return { error: 'This flow was not given a row to run on. Go back to the grid and run it from there.' };
    return {
        grid,
        action,
        on: pick('on') === 'selection' ? 'selection' : 'row',
        ids,
        back,
        token,
        fromThisTab: Boolean(entry)
    };
}

function parseJson(json) {
    try {
        return typeof json === 'string' && json ? JSON.parse(json) : null;
    } catch {
        return null;
    }
}

/** Forget what was kept for a hand-over, once it has been read. */
export function forget(token, storage) {
    try {
        if (storage && token) storage.removeItem(STORE_PREFIX + token);
    } catch {
        // Nothing kept, or no storage: nothing to forget.
    }
}

/** The way back, marked so the grid knows which flow came back. */
export function withDone(back, ns, token) {
    if (!back) return null;
    return { ...back, state: { ...(back.state || {}), [`${ns}__flowDone`]: token } };
}

/** The flowDone marker on a page reference, or ''. */
export function doneToken(ref, ns) {
    return (ref && ref.state && ref.state[`${ns}__flowDone`]) || '';
}

/** The flow's input variables: one row's Id, or the selected Ids as the text collection `ids`. */
export function flowInputs(action, run) {
    return run.on === 'selection'
        ? [{ name: 'ids', type: 'String', value: run.ids }]
        : [{ name: action.inputName || 'recordId', type: 'String', value: run.ids[0] }];
}

/** Where Lightning shows a quick action's window. */
export const QUICK_PATH = '/lightning/action/quick/';

const QUICK_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/;

/**
 * The address of a quick action's window on one record, over the page at
 * `back` (its path and query); null when any part is not what it should be,
 * or the page is not one of Lightning Experience's (where the window opens).
 */
export function quickActionUrl(name, recordId, back) {
    const page = String(back || '');
    if (!QUICK_NAME_RE.test(String(name || '')) || !ID_RE.test(String(recordId || ''))) return null;
    if (!page.startsWith('/lightning/') || isQuickActionPath(page)) return null;
    return (
        `${QUICK_PATH}${name}?objectApiName&context=RECORD_DETAIL&recordId=${recordId}` +
        `&backgroundContext=${encodeURIComponent(page)}`
    );
}

/** Is this address a quick action's window? */
export function isQuickActionPath(path) {
    return String(path || '').startsWith(QUICK_PATH);
}
