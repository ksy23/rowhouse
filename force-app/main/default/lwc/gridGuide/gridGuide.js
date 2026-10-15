/**
 * gridGuide — the Grid Guide tab: Rowhouse's documentation, inside
 * Salesforce. A header with the guide's sections, then one page
 * (c/guideContent), opened at a section when the address names one:
 *
 *   /lightning/n/Grid_Guide?c__page=configure&c__section=column
 *
 * WHO SEES WHAT
 * Everyone reads Welcome, the User guide, the Tutorials and the Reference.
 * Get started, the Configuration reference and Features in depth are for grid
 * admins: people with the Rowhouse_Grid_Admin custom permission (the Rowhouse Grid
 * Admin permission set). Anyone else who follows a link to one is told so.
 * The pages are not secret; this keeps the guide to what each reader can use.
 *
 * BACK TO TOP
 * Once the guide's header (its logo and sections) has scrolled out of view, a
 * round arrow button floats at the bottom right of the page. It scrolls back to
 * the header, smoothly unless the reader prefers reduced motion, and moves focus
 * to the "Grid Guide" heading, so the next Tab reaches the sections. Hidden, it
 * is neither seen, focused nor announced. The header is watched with
 * IntersectionObserver, or, where Locker has none (HR-23), on scroll.
 *
 * NO PUBLIC INPUTS
 * It is exposed only so it can be a Lightning tab (lightning__Tab). It has no
 * @api members, so it adds nothing permanent to the package (HR-2).
 */
import { LightningElement, wire } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import IS_ADMIN from '@salesforce/customPermission/Rowhouse_Grid_Admin';
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

export default class GridGuide extends NavigationMixin(LightningElement) {
    page = HOME_PAGE;
    section = '';
    /** True once the header has scrolled out of view: Back to top shows. */
    showTop = false;

    // Non-reactive (HR-20).
    _layout = { toTop: false, watching: false, observer: null, onScroll: null };

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
        if (!this._layout.watching) this.watchHeader();
        if (!this._layout.toTop) return;
        this._layout.toTop = false;
        const top = this.template.querySelector('.rh-guide');
        if (top && typeof top.scrollIntoView === 'function') top.scrollIntoView({ block: 'start' });
    }

    disconnectedCallback() {
        if (this._layout.observer) this._layout.observer.disconnect();
        if (this._layout.onScroll) window.removeEventListener('scroll', this._layout.onScroll, true);
        this._layout.observer = null;
        this._layout.onScroll = null;
        this._layout.watching = false;
    }

    /**
     * Back to top shows while the header is above the top of the window, and
     * not while it is in view or below it. Our own header is observed, never a
     * shared element (HR-24).
     */
    watchHeader() {
        const header = this.template.querySelector('.rh-guide-header');
        if (!header) return;
        this._layout.watching = true;
        const show = above => {
            if (above !== this.showTop) this.showTop = above;
        };
        if (typeof IntersectionObserver === 'function') {
            this._layout.observer = new IntersectionObserver(entries => {
                const entry = entries[entries.length - 1];
                show(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
            });
            this._layout.observer.observe(header);
        } else if (typeof window !== 'undefined') {
            let queued = false;
            this._layout.onScroll = () => {
                if (queued) return;
                queued = true;
                // eslint-disable-next-line @lwc/lwc/no-async-operation -- one measurement per frame, however fast the scroll
                requestAnimationFrame(() => {
                    queued = false;
                    show(header.getBoundingClientRect().bottom <= 0);
                });
            };
            // Capture: the page may scroll inside a container rather than the window.
            window.addEventListener('scroll', this._layout.onScroll, { capture: true, passive: true });
        }
    }

    get topClass() {
        return 'rh-guide-top' + (this.showTop ? ' rh-guide-top_shown' : '');
    }

    /** Back to top: to the header, and focus on the guide's heading. */
    handleTop() {
        const reduce =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const top = this.template.querySelector('.rh-guide');
        if (top && typeof top.scrollIntoView === 'function') {
            top.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        }
        const heading = this.template.querySelector('.rh-guide-heading');
        if (heading) heading.focus({ preventScroll: true });
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
