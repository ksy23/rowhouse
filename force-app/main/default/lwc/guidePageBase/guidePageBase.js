/**
 * guidePageBase — what every Grid Guide page does. Each page
 * (c/guidePage…, built by guide/build.js) is a template and this class.
 *
 *  - Links. A link to another page navigates within the Grid Guide tab, so
 *    the browser's Back works; with Ctrl, Cmd, Shift or a middle click it
 *    opens as the browser would, in a new tab or window. A link to a section
 *    of the same page scrolls there.
 *  - Sections. `section` names one to open the page at: it scrolls into view
 *    when the page appears, and whenever the section changes.
 *  - Copy buttons put their value on the clipboard and say so in a toast.
 *  - On this page. The side list marks the section being read.
 *  - The Welcome page's animated example: its focus ring, editor and pointer
 *    are put on real cells, which only a browser can measure.
 *
 * One click handler on the page's root does all of it: the pages are static
 * templates, so their links and buttons carry data- attributes and no handlers
 * of their own. Nothing here writes to state the template reads (HR-20).
 */
import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { guideRef } from 'c/guideRoute';
import { namespaceOf } from 'c/gridFlowRoute';

/** How a section is found: Lightning rewrites ids, so the build adds data-anchor. */
function anchorSelector(name) {
    return `[data-anchor="${String(name).replace(/["\\]/g, '')}"]`;
}

/** Copy text, by the Clipboard API where the page may use it, else by a selected text area. */
export function copyText(text, doc) {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        return nav.clipboard.writeText(text).then(
            () => true,
            () => copyBySelection(text, doc)
        );
    }
    return Promise.resolve(copyBySelection(text, doc));
}

function copyBySelection(text, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.body || typeof d.execCommand !== 'function') return false;
    const area = d.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    d.body.appendChild(area);
    area.select();
    let ok = false;
    try {
        ok = d.execCommand('copy');
    } catch {
        ok = false;
    }
    d.body.removeChild(area);
    return ok;
}

export default class GuidePageBase extends NavigationMixin(LightningElement) {
    // Non-reactive (HR-20): nothing the template reads, so renderedCallback may write it.
    _layout = { section: '', scrolledTo: null, rendered: false, observer: null, onResize: null, demo: null };

    /** The section to open the page at; '' for the top. */
    @api
    get section() {
        return this._layout.section;
    }
    set section(value) {
        this._layout.section = value || '';
        if (this._layout.rendered) this.scrollToSection();
    }

    get namespace() {
        return namespaceOf(this.template.host);
    }

    renderedCallback() {
        if (this._layout.rendered) return;
        this._layout.rendered = true;
        this.scrollToSection();
        this.watchSections();
        this.placeDemo();
    }

    disconnectedCallback() {
        const rt = this._layout;
        if (rt.observer) rt.observer.disconnect();
        if (rt.onResize) window.removeEventListener('resize', rt.onResize);
        rt.observer = null;
        rt.onResize = null;
        rt.rendered = false;
        rt.scrolledTo = null;
    }

    /** Scrolls the asked-for section into view, once per section asked for. */
    scrollToSection() {
        const rt = this._layout;
        const name = rt.section;
        if (!name || rt.scrolledTo === name) return;
        const target = this.template.querySelector(anchorSelector(name));
        if (!target) return;
        rt.scrolledTo = name;
        if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
    }

    /** One handler for the page: links, section links and copy buttons. */
    handleClick(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        const copy = target.closest('button[data-copy]');
        if (copy) {
            this.copy(copy.getAttribute('data-copy'));
            return;
        }
        const link = target.closest('a[data-page], a[data-anchor-link]');
        if (!link) return;
        if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const inPage = link.getAttribute('data-anchor-link');
        if (inPage) {
            const section = this.template.querySelector(anchorSelector(inPage));
            if (section && typeof section.scrollIntoView === 'function') section.scrollIntoView({ block: 'start', behavior: 'smooth' });
            return;
        }
        this[NavigationMixin.Navigate](guideRef(this.namespace, link.getAttribute('data-page'), link.getAttribute('data-section') || ''));
    }

    copy(text) {
        return copyText(text).then(ok => {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: ok ? 'Copied' : 'Could not copy',
                    message: ok ? `"${text}" is on your clipboard.` : `Select "${text}" and copy it yourself.`,
                    variant: ok ? 'success' : 'warning'
                })
            );
            return ok;
        });
    }

    /** Marks the side list's entry for the section being read (when the browser can tell). */
    watchSections() {
        const links = this.template.querySelectorAll('.rh-side a[data-anchor-link]');
        if (!links.length || typeof IntersectionObserver !== 'function') return;
        const byName = new Map();
        links.forEach(a => byName.set(a.getAttribute('data-anchor-link'), a));
        let current = null;
        const observer = new IntersectionObserver(
            entries => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const a = byName.get(entry.target.getAttribute('data-anchor'));
                    if (!a || a === current) return;
                    if (current) current.classList.remove('rh-on');
                    a.classList.add('rh-on');
                    current = a;
                });
            },
            { rootMargin: '-20% 0px -70% 0px' }
        );
        this.template.querySelectorAll('[data-anchor]').forEach(el => {
            if (byName.has(el.getAttribute('data-anchor'))) observer.observe(el);
        });
        this._layout.observer = observer;
    }

    /** The Welcome page's example edit: rings, editor and pointer on real cells. */
    placeDemo() {
        const demo = this.template.querySelector('.rh-demo');
        if (!demo) return;
        const target = demo.querySelector('td.rh-target');
        const start = demo.querySelector('td.rh-start');
        if (!target || !start) return;
        const save = demo.querySelector('.rh-m-pill .rh-mb.rh-p');
        const place = () => {
            const box = demo.getBoundingClientRect();
            if (!box.width) return;
            const t = target.getBoundingClientRect();
            const s = start.getBoundingClientRect();
            const sv = save ? save.getBoundingClientRect() : t;
            const set = (k, v) => demo.style.setProperty(k, Math.round(v) + 'px');
            set('--rh-r0x', s.left - box.left);
            set('--rh-r0y', s.top - box.top);
            set('--rh-r1x', t.left - box.left);
            set('--rh-r1y', t.top - box.top);
            set('--rh-c0x', box.width - 40);
            set('--rh-c0y', box.height - 30);
            set('--rh-c1x', t.left - box.left + t.width * 0.55);
            set('--rh-c1y', t.top - box.top + t.height * 0.55);
            set('--rh-c2x', sv.left - box.left + sv.width * 0.5);
            set('--rh-c2y', sv.top - box.top + sv.height * 0.5);
            set('--rh-tw', t.width);
            set('--rh-th', t.height);
            demo.classList.add('rh-ready');
        };
        place();
        this._layout.onResize = place;
        window.addEventListener('resize', place);
    }
}
