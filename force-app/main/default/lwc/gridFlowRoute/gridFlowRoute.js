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
 * Ids and the page to go back to travel in the address when there are at most
 * IDS_IN_URL Ids, and otherwise in the tab's session storage under a random
 * key that the address carries instead. State keys carry the package's
 * namespace (c__ unmanaged, rowhouse__ managed), as Lightning requires.
 *
 * THE WAY BACK
 * When the flow finishes, or is left, the page goes back to the grid's page
 * with one more state key, flowDone, set to a token the grid chose: the grid,
 * if it is the same one, reads that action's rows again.
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
 * A page reference to keep as the way back: plain, and without an earlier
 * flowDone marker, so it does not say a flow finished that did not.
 */
export function backRef(ref, ns) {
    if (!ref || !ref.type) return null;
    const state = { ...(ref.state || {}) };
    delete state[`${ns}__flowDone`];
    return { type: ref.type, attributes: { ...(ref.attributes || {}) }, state };
}

/**
 * The page reference that opens the flow page. `run` is { grid, action, on,
 * ids, back, token }; `storage` is the tab's session storage, or null. Null
 * when there are too many Ids and nowhere to keep them.
 */
export function flowPageRef(ns, run, storage) {
    const ids = (run.ids || []).filter(id => ID_RE.test(id));
    const state = {
        [`${ns}__grid`]: run.grid,
        [`${ns}__action`]: run.action,
        [`${ns}__on`]: run.on === 'selection' ? 'selection' : 'row',
        [`${ns}__token`]: run.token
    };
    if (ids.length <= IDS_IN_URL) {
        state[`${ns}__ids`] = ids.join(',');
        if (run.back) state[`${ns}__back`] = JSON.stringify(run.back);
    } else {
        try {
            storage.setItem(STORE_PREFIX + run.token, JSON.stringify({ ids, back: run.back || null }));
        } catch {
            return null; // no storage, and too many Ids for the address
        }
    }
    return { type: 'standard__component', attributes: { componentName: `${ns}__${FLOW_PAGE}` }, state };
}

/**
 * What the flow page was asked to run, from its page reference's state:
 * { grid, action, on, ids, back, token }, or { error } in words for the user.
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
    let ids = null;
    let back = null;
    const inUrl = pick('ids');
    if (typeof inUrl === 'string') {
        ids = inUrl.split(',').filter(Boolean);
        back = parseRef(pick('back'));
    } else {
        let kept = null;
        try {
            kept = JSON.parse(storage.getItem(STORE_PREFIX + token) || 'null');
        } catch {
            kept = null;
        }
        if (!kept || !Array.isArray(kept.ids)) {
            return {
                error: 'The rows this flow was to run on were not found in this browser tab. Go back to the grid and run it again.'
            };
        }
        ids = kept.ids;
        back = kept.back && kept.back.type ? kept.back : null;
    }
    ids = ids.filter(id => ID_RE.test(id));
    if (!ids.length)
        return { error: 'This flow was not given a row to run on. Go back to the grid and run it from there.' };
    return { grid, action, on: pick('on') === 'selection' ? 'selection' : 'row', ids, back, token };
}

function parseRef(json) {
    try {
        const ref = json ? JSON.parse(json) : null;
        return ref && ref.type ? ref : null;
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
