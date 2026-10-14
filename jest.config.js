// Jest for Lightning Web Components.
//
// The pre-written suites live in test-data/tests/jest, next to the fixture that
// is generated from the seed CSV, so they are added to testMatch explicitly.
// Component-local tests live in each bundle's __tests__ folder, as usual.
const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
    ...jestConfig,
    testMatch: ['<rootDir>/force-app/**/__tests__/**/*.test.js', '<rootDir>/test-data/tests/jest/**/*.test.js'],
    setupFilesAfterEnv: [...(jestConfig.setupFilesAfterEnv || []), '<rootDir>/jest.setup.js'],
    modulePathIgnorePatterns: ['<rootDir>/.localdevserver'],
    // The accessibility checks (axe) take a few seconds each on a laptop and
    // can take several times longer on a shared CI runner, past Jest's 5-second
    // default. A test that needs longer still sets its own limit.
    testTimeout: 30000,
    // A CSS-only module (the Grid Guide's stylesheet, and the Grid Admin
    // tab's) has no .js for Jest's resolver to find; point each
    // @import at the file itself.
    moduleNameMapper: {
        ...(jestConfig.moduleNameMapper || {}),
        '^c/guideStyles$': '<rootDir>/force-app/main/default/lwc/guideStyles/guideStyles.css',
        '^c/adminStyles$': '<rootDir>/force-app/main/default/lwc/adminStyles/adminStyles.css',
        // The shipped stub has no tooltip; Salesforce's component does.
        '^lightning/buttonIconStateful$':
            '<rootDir>/test-data/tests/jest/stubs/lightning/buttonIconStateful/buttonIconStateful.js'
    },
    collectCoverageFrom: ['force-app/**/lwc/**/*.js', '!**/__tests__/**']
};
