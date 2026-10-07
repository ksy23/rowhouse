/**
 * rowhouseGuide — the Grid Guide tab: Rowhouse's documentation, inside
 * Salesforce. A header with the guide's sections, then one page
 * (c/guideContent), opened at a section when the address names one:
 *
 *   /lightning/n/Rowhouse_Guide?c__page=configure&c__section=column
 *
 * WHO SEES WHAT
 * Everyone reads Welcome, the User guide, the Tutorials and the Reference.
 * Get started, the Configuration reference and Features in depth are for grid
 * admins: people with the Rowhouse_Admin custom permission (the Rowhouse Grid
 * Admin permission set). Anyone else who follows a link to one is told so.
 * The pages are not secret; this keeps the guide to what each reader can use.
 *
 * NO PUBLIC INPUTS
 * It is exposed only so it can be a Lightning tab (lightning__Tab). It has no
 * @api members, so it adds nothing permanent to the package (HR-2).
 */
import { LightningElement, wire } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import IS_ADMIN from '@salesforce/customPermission/Rowhouse_Admin';
import LOGO from '@salesforce/resourceUrl/RowhouseLogo';
import { pageOf } from 'c/guideCatalog';
import { guideRef, guideUrl, readGuideState, isAdminPage, pagesFor, HOME_PAGE } from 'c/guideRoute';
import { namespaceOf } from 'c/gridFlowRoute';

/** The guide's sections, as the header lists them, by the page each opens. */
const SECTION_LABELS = {
    welcome: 'Welcome',
    start: 'Get started',
    configure: 'Configure',
    features: 'Features',
    using: 'User guide',
    tutorials: 'Tutorials',
    reference: 'Reference'
};

export default class RowhouseGuide extends NavigationMixin(LightningElement) {
    page = HOME_PAGE;
    section = '';

    // Non-reactive (HR-20).
    _layout = { toTop: false };

    get isAdmin() {
        return Boolean(IS_ADMIN);
    }

    get namespace() {
        return namespaceOf(this.template.host);
    }

    get logoUrl() {
        return LOGO;
    }

    @wire(CurrentPageReference)
    setPageReference(ref) {
        const { page, section } = readGuideState(ref && ref.state, this.namespace);
        if (page !== this.page && !section) this._layout.toTop = true;
        this.page = page;
        this.section = section;
    }

    renderedCallback() {
        if (!this._layout.toTop) return;
        this._layout.toTop = false;
        const top = this.template.querySelector('.rh-guide');
        if (top && typeof top.scrollIntoView === 'function') top.scrollIntoView({ block: 'start' });
    }

    /** The header's sections: the top-level pages this reader may read. */
    get navItems() {
        const here = pageOf(this.page);
        const current = here ? here.section : HOME_PAGE;
        return pagesFor(this.isAdmin)
            .filter(p => SECTION_LABELS[p.id] && p.section === p.id)
            .map(p => ({
                id: p.id,
                label: SECTION_LABELS[p.id],
                url: guideUrl(this.namespace, p.id),
                current: p.id === current ? 'page' : null,
                className: 'rh-guide-nav-item' + (p.id === current ? ' rh-guide-nav-item_current' : '')
            }));
    }

    /** False when the page is for grid admins and this reader is not one. */
    get showPage() {
        return this.isAdmin || !isAdminPage(this.page);
    }

    get pageTitle() {
        const p = pageOf(this.page);
        return p ? p.title : '';
    }

    get adminOnlyText() {
        return `"${this.pageTitle}" is for the people who build grids: it opens with the Rowhouse Grid Admin permission set. Ask your Salesforce admin if you need it.`;
    }

    get usingUrl() {
        return guideUrl(this.namespace, 'using');
    }

    /** A section of the header: move within the tab, so Back works. */
    handleNav(event) {
        if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const page = event.currentTarget.dataset.page;
        this[NavigationMixin.Navigate](guideRef(this.namespace, page));
    }
}
