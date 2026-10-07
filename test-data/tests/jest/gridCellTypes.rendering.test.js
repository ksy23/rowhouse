/**
 * Cell rendering against the edge-case seed set.
 *
 * WHY THIS TEST EXISTS
 * These are the values that break grids in real orgs. Each assertion names its
 * TC number so a failure points straight at the seed record and its
 * Expected__c text — no archaeology needed.
 *
 * TC-017, TC-018 and TC-046 are security tests, not cosmetic ones.
 */
import { createElement } from 'lwc';
import CellText from 'c/cellText';
import CellNumber from 'c/cellNumber';
import CellDate from 'c/cellDate';
import CellPicklist from 'c/cellPicklist';

const mount = (Ctor, props) => {
    const el = createElement('rowhouse-cell', { is: Ctor });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
};
afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

describe('text cell', () => {
    it('TC-004 preserves leading zeros', () => {
        const el = mount(CellText, { value: '00123' });
        expect(el.shadowRoot.textContent).toContain('00123');
    });

    it('TC-017 renders script content as text and does not execute it', () => {
        const payload = '<script>window.__xss = true;</script>';
        const el = mount(CellText, { value: payload });
        expect(el.shadowRoot.querySelector('script')).toBeNull();
        expect(window.__xss).toBeUndefined();
        expect(el.shadowRoot.textContent).toContain('<script>');
    });

    it('TC-018 does not break out of an attribute context', () => {
        const el = mount(CellText, { value: '"><img src=x onerror=alert(1)>' });
        expect(el.shadowRoot.querySelector('img')).toBeNull();
    });

    it('TC-012 counts emoji by code point, not UTF-16 length', () => {
        const el = mount(CellText, { value: '🧱🏘️' });
        // A naive .length here reads 4+ and a character counter would lie.
        expect(el.displayLength).toBe([...'🧱🏘️'].length);
    });

    it('TC-001 vs TC-002 distinguishes null from empty string', () => {
        expect(mount(CellText, { value: null }).isNull).toBe(true);
        expect(mount(CellText, { value: '' }).isNull).toBe(false);
    });
});

describe('number cell', () => {
    it('TC-003 renders zero rather than blank', () => {
        expect(mount(CellNumber, { value: 0 }).shadowRoot.textContent.trim()).toBe('0');
    });

    it('TC-024 carries an 18-digit value without float rounding', () => {
        const big = '999999999999999999';
        const el = mount(CellNumber, { value: big });
        // Beyond Number.MAX_SAFE_INTEGER, so the value must stay a string.
        expect(el.shadowRoot.textContent.replace(/[^0-9]/g, '')).toBe(big);
    });

    it('TC-025 round-trips a percent without multiplying by 100', () => {
        const el = mount(CellNumber, { value: 50, type: 'percent' });
        expect(el.editValue).toBe(50);
    });
});

describe('date cell', () => {
    it('TC-027 does not shift a Date across timezones', () => {
        // A Date has no timezone. Rendering must be identical regardless of the
        // user's offset — if this fails, the code is treating it as a DateTime.
        const el = mount(CellDate, { value: '2026-01-01' });
        expect(el.shadowRoot.textContent).toMatch(/2026/);
        expect(el.shadowRoot.textContent).not.toMatch(/2025/);
    });
});

describe('picklist cell', () => {
    it('TC-036 renders a value that is no longer in the active set', () => {
        const el = mount(CellPicklist, {
            value: 'Obsolete',
            options: [
                { label: 'Alpha', value: 'Alpha' },
                { label: 'Beta', value: 'Beta' }
            ]
        });
        // Blanking this is data loss, and it is the most common real-org case.
        expect(el.shadowRoot.textContent).toContain('Obsolete');
        expect(el.value).toBe('Obsolete');
    });

    it('TC-039 renders disabled when the controlling value has no dependents', () => {
        const el = mount(CellPicklist, { value: null, options: [], dependentOn: 'Services' });
        expect(el.shadowRoot.querySelector('[disabled]')).not.toBeNull();
    });
});
