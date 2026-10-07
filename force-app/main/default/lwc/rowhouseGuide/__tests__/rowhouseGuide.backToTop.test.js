/**
 * The Grid Guide's Back to top: hidden until the header has scrolled out of
 * view, then a button that returns to the header and puts focus on the
 * guide's heading. Watched with IntersectionObserver, or on scroll where the
 * browser has none (Lightning Locker).
 */
import { createElement } from 'lwc';
import RowhouseGuide from 'c/rowhouseGuide';
import { CurrentPageReference } from 'lightning/navigation';

jest.mock('@salesforce/customPermission/Rowhouse_Admin', () => ({ default: true }), { virtual: true });

jest.mock('lightning/navigation', () => {
    // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    const Navigate = Symbol('Navigate');
    const GenerateUrl = Symbol('GenerateUrl');
    const NavigationMixin = Base =>
        class extends Base {
            [Navigate]() {}
            [GenerateUrl]() {
                return Promise.resolve('');
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const settle = async () => {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

/** A stand-in IntersectionObserver that the test drives by hand. */
let observers;
class FakeObserver {
    constructor(callback) {
        this.callback = callback;
        this.targets = [];
        this.disconnect = jest.fn();
        observers.push(this);
    }
    observe(target) {
        this.targets.push(target);
    }
    report(isIntersecting, bottom) {
        this.callback([{ isIntersecting, boundingClientRect: { bottom }, target: this.targets[0] }]);
    }
}

let el;
const open = async () => {
    el = createElement('c-rowhouse-guide', { is: RowhouseGuide });
    document.body.appendChild(el);
    // eslint-disable-next-line @lwc/lwc/no-unexpected-wire-adapter-usages -- the test adapter's emit
    CurrentPageReference.emit({
        type: 'standard__navItemPage',
        attributes: { apiName: 'Rowhouse_Guide' },
        state: { c__page: 'tutorials' }
    });
    await settle();
};
const $ = s => el.shadowRoot.querySelector(s);
const wrapper = () => $('.rh-guide-top');
const shown = () => wrapper().classList.contains('rh-guide-top_shown');
const button = () => $('.rh-guide-top lightning-button-icon');

const savedObserver = window.IntersectionObserver;
const savedMatchMedia = window.matchMedia;
let scrolled;
beforeEach(() => {
    observers = [];
    window.IntersectionObserver = FakeObserver;
    window.matchMedia = jest.fn(() => ({ matches: false }));
    scrolled = [];
    Element.prototype.scrollIntoView = jest.fn(function scroll(options) {
        scrolled.push({ el: this, options });
    });
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    window.IntersectionObserver = savedObserver;
    window.matchMedia = savedMatchMedia;
    jest.restoreAllMocks();
});

describe('Back to top', () => {
    it('is hidden while the header is in view', async () => {
        await open();
        expect(button()).not.toBeNull();
        expect(shown()).toBe(false);
        const io = observers[0];
        expect(io.targets[0].classList.contains('rh-guide-header')).toBe(true);
        io.report(true, 112);
        await settle();
        expect(shown()).toBe(false);
    });

    it('shows once the header is above the window, and hides when it comes back', async () => {
        await open();
        const io = observers[0];
        io.report(false, -40);
        await settle();
        expect(shown()).toBe(true);
        io.report(true, 60);
        await settle();
        expect(shown()).toBe(false);
    });

    it('stays hidden when the header is out of view below the window', async () => {
        await open();
        observers[0].report(false, 2400);
        await settle();
        expect(shown()).toBe(false);
    });

    it('is named for screen readers and says what it does on hover', async () => {
        await open();
        expect(button().alternativeText).toBe('Back to top');
        expect(button().title).toBe('Back to top');
        expect(button().iconName).toBe('utility:arrowup');
    });

    it('scrolls back to the header smoothly and puts focus on the heading', async () => {
        await open();
        observers[0].report(false, -40);
        await settle();
        button().click();
        const last = scrolled[scrolled.length - 1];
        expect(last.el.classList.contains('rh-guide')).toBe(true);
        expect(last.options).toEqual({ block: 'start', behavior: 'smooth' });
        const heading = $('.rh-guide-heading');
        expect(el.shadowRoot.activeElement).toBe(heading);
        expect(heading.getAttribute('tabindex')).toBe('-1');
        expect(heading.textContent).toBe('Grid Guide');
    });

    it('jumps without animation when the reader prefers reduced motion', async () => {
        window.matchMedia = jest.fn(q => ({ matches: q.includes('reduce') }));
        await open();
        button().click();
        expect(scrolled[scrolled.length - 1].options).toEqual({ block: 'start', behavior: 'auto' });
    });

    it('stops watching when the tab closes', async () => {
        await open();
        const io = observers[0];
        el.remove();
        expect(io.disconnect).toHaveBeenCalled();
    });

    // The button only: the page around it has its own check, which is slow.
    it('is accessible, hidden and shown', async () => {
        await open();
        await expect($('.rh-guide-top-dock')).toBeAccessible();
        observers[0].report(false, -40);
        await settle();
        await expect($('.rh-guide-top-dock')).toBeAccessible();
    });
});

describe('Back to top without IntersectionObserver (Lightning Locker)', () => {
    beforeEach(() => {
        delete window.IntersectionObserver;
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
            cb();
            return 1;
        });
    });

    it('measures the header on scroll', async () => {
        const add = jest.spyOn(window, 'addEventListener');
        await open();
        expect(add).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true, passive: true });
        const header = $('.rh-guide-header');
        header.getBoundingClientRect = () => ({ top: -150, bottom: -30 });
        window.dispatchEvent(new CustomEvent('scroll'));
        await settle();
        expect(shown()).toBe(true);
        header.getBoundingClientRect = () => ({ top: 20, bottom: 132 });
        window.dispatchEvent(new CustomEvent('scroll'));
        await settle();
        expect(shown()).toBe(false);
    });

    it('stops listening when the tab closes', async () => {
        const remove = jest.spyOn(window, 'removeEventListener');
        await open();
        el.remove();
        expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    });
});
