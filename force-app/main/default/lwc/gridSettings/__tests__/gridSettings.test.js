/**
 * The gear's dialog: the Rowhouse mark and the grid's title, the editor
 * for this grid, and closing through the editor so unsaved changes are asked
 * about first.
 */
import { createElement } from 'lwc';
import GridSettings from 'c/gridSettings';

// The editor is the real one (it has its own tests); its server calls answer here.
jest.mock('@salesforce/apex/GridAdminController.readConfig', () => ({ default: jest.fn(() => new Promise(() => {})) }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.listObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.describeObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.checkDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.canSave', () => ({ default: jest.fn() }), { virtual: true });

const $ = (el, selector) => el.shadowRoot.querySelector(selector);

function mount() {
    const el = createElement('c-grid-settings', { is: GridSettings });
    el.configName = 'Deals';
    el.gridTitle = 'Deals';
    document.body.appendChild(el);
    return el;
}

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
});

it('shows the Rowhouse mark, the grid\'s title and its editor', () => {
    const el = mount();
    expect($(el, '.rh-settings-mark').getAttribute('src')).toContain('RowhouseMark');
    expect($(el, 'h1').textContent).toBe('Grid settings: Deals');
    expect($(el, 'c-grid-config-editor').configName).toBe('Deals');
});

it('closes through the editor, from the close button and from Escape', () => {
    const el = mount();
    const closed = [];
    el.addEventListener('close', () => closed.push('close'));
    // With nothing changed, the editor closes at once; with changes it would ask first.
    $(el, '.rh-settings-close').dispatchEvent(new CustomEvent('click'));
    $(el, 'section').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual(['close', 'close']);
});

it('passes on the editor\'s close and saved', () => {
    const el = mount();
    const events = [];
    el.addEventListener('close', () => events.push('close'));
    el.addEventListener('saved', e => events.push('saved:' + e.detail.configName));
    $(el, 'c-grid-config-editor').dispatchEvent(new CustomEvent('saved', { detail: { configName: 'Deals' } }));
    $(el, 'c-grid-config-editor').dispatchEvent(new CustomEvent('close'));
    expect(events).toEqual(['saved:Deals', 'close']);
});
