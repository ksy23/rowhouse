/**
 * guideRoute — addresses of the Grid Guide. Plain functions over plain
 * objects (HR-28), so the tab, its pages, the grid and the Grid Admin tab all
 * build them the same way.
 *
 * An address names a page and, optionally, a section of it:
 *   /lightning/n/Grid_Guide?c__page=configure&c__section=column
 * State keys carry the package's namespace (c__ unmanaged, rowhouse__
 * managed), as Lightning requires, and so does the tab's API name when there
 * is one. Welcome is the page with no c__page at all.
 */
import { NavigationMixin } from 'lightning/navigation';
import { PAGES, pageOf } from 'c/guideCatalog';

/** The Grid Guide tab's API name, without its namespace. */
export const GUIDE_TAB = 'Grid_Guide';
/** The page the tab opens on. */
export const HOME_PAGE = 'welcome';

const SECTION_RE = /^[\w-]{1,80}$/;

function prefix(ns) {
    return ns && ns !== 'c' ? ns + '__' : '';
}

/** The page reference of a guide page, opened at a section when one is given. */
export function guideRef(ns, page, section) {
    const key = (ns || 'c') + '__';
    const state = {};
    if (page && page !== HOME_PAGE) state[key + 'page'] = page;
    if (section && SECTION_RE.test(section)) state[key + 'section'] = section;
    return { type: 'standard__navItemPage', attributes: { apiName: prefix(ns) + GUIDE_TAB }, state };
}

/**
 * The address of a guide page, for a link's href: the same address guideRef
 * leads to, so a link opened in a new browser tab lands on the same page.
 * (guide/build.js writes the guide's own links the same way.)
 */
export function guideUrl(ns, page, section) {
    const key = (ns || 'c') + '__';
    const params = [];
    if (page && page !== HOME_PAGE) params.push(key + 'page=' + encodeURIComponent(page));
    if (section && SECTION_RE.test(section)) params.push(key + 'section=' + encodeURIComponent(section));
    return `/lightning/n/${prefix(ns)}${GUIDE_TAB}` + (params.length ? '?' + params.join('&') : '');
}

/**
 * The page and section a page reference's state asks for. An unknown page
 * is Welcome; a section that is not a plain name is dropped.
 */
export function readGuideState(state, ns) {
    const key = (ns || 'c') + '__';
    const s = state || {};
    const asked = typeof s[key + 'page'] === 'string' ? s[key + 'page'] : '';
    const page = pageOf(asked) ? asked : HOME_PAGE;
    const rawSection = typeof s[key + 'section'] === 'string' ? s[key + 'section'] : '';
    const section = SECTION_RE.test(rawSection) ? rawSection : '';
    return { page, section, unknown: Boolean(asked) && !pageOf(asked) };
}

/** Whether a page is for grid admins only. */
export function isAdminPage(page) {
    const p = pageOf(page);
    return Boolean(p && p.audience === 'admin');
}

/** The pages a reader sees in the guide's navigation, in order. */
export function pagesFor(isAdmin) {
    return PAGES.filter(p => isAdmin || p.audience !== 'admin');
}

/**
 * Opens the guide at a page and section in a new browser tab, so whatever the
 * reader was doing (unsaved changes in a grid, a grid half built on the Grid
 * Admin tab) stays as it was. `cmp` is a component with NavigationMixin, and
 * `ns` its namespace (c/gridFlowRoute's namespaceOf).
 */
export function openGuide(cmp, ns, page, section) {
    const ref = guideRef(ns, page, section);
    return Promise.resolve(cmp[NavigationMixin.GenerateUrl](ref)).then(url => {
        if (url) window.open(url, '_blank');
        return url;
    });
}
