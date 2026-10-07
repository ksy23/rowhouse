/**
 * ESLint (flat config). Salesforce's recommended LWC rules, plus the five
 * Rowhouse rules that enforce hard rules at commit time. Warnings fail the build
 * (--max-warnings 0), so every rule here is effectively an error.
 */
'use strict';
const lwcRecommended = require('@salesforce/eslint-config-lwc/recommended');
const rowhouse = require('./eslint-rules');

module.exports = [
    { ignores: ['node_modules/**', 'coverage/**', '.sfdx/**', '.sf/**', 'test-data/scripts/**'] },
    ...lwcRecommended,
    {
        files: ['force-app/**/lwc/**/*.js'],
        plugins: { rowhouse },
        rules: {
            'rowhouse/no-clone-in-api-setter': 'error',
            'rowhouse/no-track-on-collections': 'error',
            'rowhouse/no-reactive-write-in-rendered-callback': ['error', { allow: ['_measurements', '_layout'] }],
            'rowhouse/no-queryselector-in-loop': 'error',
            'rowhouse/no-shared-element-observer': 'error'
        }
    },
    {
        // Prettier owns layout. When it breaks a long arrow function over two
        // lines it drops the parentheses this rule asks for, so the two would
        // disagree forever (eslint-config-prettier turns it off for the same
        // reason).
        rules: { 'no-confusing-arrow': 'off' }
    },
    {
        files: ['**/__tests__/**/*.js', 'test-data/tests/jest/**/*.js'],
        rules: {
            '@lwc/lwc/no-async-operation': 'off',
            '@lwc/lwc/no-document-query': 'off'
        }
    }
];
