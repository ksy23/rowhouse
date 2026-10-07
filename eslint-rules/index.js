/**
 * eslint-plugin-rowhouse — the five hard rules that ESLint can see.
 *
 * Two more (no index as key, no <slot> in a table) operate on templates, which
 * ESLint never parses; they live in scripts/checks/templates.js instead.
 */
'use strict';

module.exports = {
    meta: { name: 'eslint-plugin-rowhouse', version: '0.1.0' },
    rules: {
        'no-clone-in-api-setter': require('./rules/no-clone-in-api-setter'),
        'no-track-on-collections': require('./rules/no-track-on-collections'),
        'no-reactive-write-in-rendered-callback': require('./rules/no-reactive-write-in-rendered-callback'),
        'no-queryselector-in-loop': require('./rules/no-queryselector-in-loop'),
        'no-shared-element-observer': require('./rules/no-shared-element-observer')
    }
};
