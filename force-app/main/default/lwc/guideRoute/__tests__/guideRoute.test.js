/**
 * Addresses of the Grid Guide: a page and a section, in the state keys
 * Lightning wants, the same as a link's href, and safe to read back.
 */
import { guideRef, guideUrl, readGuideState, isAdminPage, pagesFor, openGuide, GUIDE_TAB, HOME_PAGE } from 'c/guideRoute';
import { PAGES } from 'c/guideCatalog';

const mockGenerate = jest.fn();
jest.mock('lightning/navigation', () => {
    const GenerateUrl = Symbol('GenerateUrl');
    const NavigationMixin = Base => Base;
    NavigationMixin.Navigate = Symbol('Navigate');
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: jest.fn() };
});

describe('guideRef', () => {
    it('names the tab and puts the page and section in c__ keys', () => {
        expect(guideRef('c', 'configure', 'column')).toEqual({
            type: 'standard__navItemPage',
            attributes: { apiName: GUIDE_TAB },
            state: { c__page: 'configure', c__section: 'column' }
        });
    });

    it('leaves the page out for Welcome, and the section out when there is none', () => {
        expect(guideRef('c', HOME_PAGE).state).toEqual({});
        expect(guideRef('c', 'using').state).toEqual({ c__page: 'using' });
    });

    it('carries a package namespace in the tab name and the keys', () => {
        expect(guideRef('rowhouse', 'using', 'keys')).toEqual({
            type: 'standard__navItemPage',
            attributes: { apiName: 'rowhouse__Rowhouse_Guide' },
            state: { rowhouse__page: 'using', rowhouse__section: 'keys' }
        });
    });

    it('drops a section that is not a plain name', () => {
        expect(guideRef('c', 'using', 'a"b').state).toEqual({ c__page: 'using' });
    });
});

describe('guideUrl', () => {
    it('is the address guideRef leads to', () => {
        expect(guideUrl('c', 'configure', 'column')).toBe('/lightning/n/Rowhouse_Guide?c__page=configure&c__section=column');
        expect(guideUrl('c', HOME_PAGE)).toBe('/lightning/n/Rowhouse_Guide');
        expect(guideUrl('rowhouse', 'using')).toBe('/lightning/n/rowhouse__Rowhouse_Guide?rowhouse__page=using');
    });
});

describe('readGuideState', () => {
    it('reads the page and section', () => {
        expect(readGuideState({ c__page: 'start', c__section: 'access' }, 'c')).toEqual({ page: 'start', section: 'access', unknown: false });
    });

    it('opens Welcome for no page, or a page the guide does not have', () => {
        expect(readGuideState({}, 'c').page).toBe(HOME_PAGE);
        expect(readGuideState(undefined, 'c').page).toBe(HOME_PAGE);
        expect(readGuideState({ c__page: 'nonsense' }, 'c')).toEqual({ page: HOME_PAGE, section: '', unknown: true });
    });

    it('ignores another namespace\'s keys and a section that is not a plain name', () => {
        expect(readGuideState({ x__page: 'start' }, 'c').page).toBe(HOME_PAGE);
        expect(readGuideState({ c__page: 'start', c__section: '<b>' }, 'c').section).toBe('');
    });
});

describe('who reads what', () => {
    it('keeps Get started, Configure and Features for grid admins', () => {
        expect(PAGES.filter(p => isAdminPage(p.id)).map(p => p.id)).toEqual(['start', 'configure', 'features']);
        expect(isAdminPage('using')).toBe(false);
        expect(isAdminPage('nonsense')).toBe(false);
    });

    it('lists every page for an admin, and the rest for everyone else, in order', () => {
        expect(pagesFor(true).map(p => p.id)).toEqual(PAGES.map(p => p.id));
        expect(pagesFor(false).map(p => p.id)).toEqual(PAGES.map(p => p.id).filter(id => !['start', 'configure', 'features'].includes(id)));
    });
});

describe('openGuide', () => {
    it('opens the page in a new browser tab', async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        const { NavigationMixin } = require('lightning/navigation'); // eslint-disable-line no-undef
        mockGenerate.mockResolvedValue('/lightning/n/Rowhouse_Guide?c__page=using');
        const cmp = { [NavigationMixin.GenerateUrl]: mockGenerate };
        const url = await openGuide(cmp, 'c', 'using');
        expect(mockGenerate).toHaveBeenCalledWith(guideRef('c', 'using'));
        expect(open).toHaveBeenCalledWith('/lightning/n/Rowhouse_Guide?c__page=using', '_blank');
        expect(url).toBe('/lightning/n/Rowhouse_Guide?c__page=using');
        open.mockRestore();
    });
});
