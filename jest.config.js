// Jest for Lightning Web Components.
//
// The pre-written suites live in test-data/tests/jest, next to the fixture that
// is generated from the seed CSV, so they are added to testMatch explicitly.
// Component-local tests live in each bundle's __tests__ folder, as usual.
const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
    ...jestConfig,
    testMatch: [
        '<rootDir>/force-app/**/__tests__/**/*.test.js',
        '<rootDir>/test-data/tests/jest/**/*.test.js'
    ],
    setupFilesAfterEnv: [...(jestConfig.setupFilesAfterEnv || []), '<rootDir>/jest.setup.js'],
    modulePathIgnorePatterns: ['<rootDir>/.localdevserver'],
    // A CSS-only module (the Grid Guide's stylesheet, and the Grid Admin
    // tab's) has no .js for Jest's resolver to find; point each
    // @import at the file itself.
    moduleNameMapper: {
        ...(jestConfig.moduleNameMapper || {}),
        '^c/guideStyles$': '<rootDir>/force-app/main/default/lwc/guideStyles/guideStyles.css',
        '^c/adminStyles$': '<rootDir>/force-app/main/default/lwc/adminStyles/adminStyles.css'
    },
    collectCoverageFrom: ['force-app/**/lwc/**/*.js', '!**/__tests__/**']
};
