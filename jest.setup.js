// @sa11y/jest adds expect(el).toBeAccessible(). It runs axe-core in JSDOM, so it
// cannot check color contrast or the ARIA descendancy rules a grid needs most —
// those run in the real-browser tier (@sa11y/wdio), not here.
import { registerSa11yMatcher } from '@sa11y/jest';
registerSa11yMatcher();

// Each test starts with nothing kept in the browser: a layout held by one
// test (c/gridPendingLayout) must not open the next test's grid differently.
beforeEach(() => {
    try {
        localStorage.clear();
    } catch {
        // No storage in this environment: nothing to clear.
    }
});
