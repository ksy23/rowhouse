/**
 * Tests for the Rowhouse ESLint rules. Each rule gets at least one case that
 * must fail — a rule that never fires is indistinguishable from no rule.
 * Run: node eslint-rules/tests/run.js
 */
'use strict';
const { RuleTester } = require('eslint');
const languageOptions = require('@salesforce/eslint-config-lwc/lib/defaults');
const plugin = require('..');

const tester = new RuleTester({ languageOptions });
const cls = body => `import { LightningElement, api, track } from 'lwc';\nexport default class X extends LightningElement {\n${body}\n}`;

tester.run('no-clone-in-api-setter', plugin.rules['no-clone-in-api-setter'], {
    valid: [
        cls('@api get rows() { return this._rows; } set rows(v) { this._rows = v; }'),
        cls('set notApi(v) { this._x = [...v]; }')
    ],
    invalid: [
        { code: cls('@api get rows() { return this._r; } set rows(v) { this._r = [...v]; }'), errors: 1 },
        { code: cls('@api get rows() { return this._r; } set rows(v) { this._r = v.slice(); }'), errors: 1 },
        { code: cls('@api get rows() { return this._r; } set rows(v) { this._r = v.map(x => x); }'), errors: 1 },
        { code: cls('@api get rows() { return this._r; } set rows(v) { this._r = Array.from(v); }'), errors: 1 },
        { code: cls('@api get cfg() { return this._c; } set cfg(v) { this._c = Object.assign({}, v); }'), errors: 1 },
        { code: cls('@api get cfg() { return this._c; } set cfg(v) { this._c = { ...v }; }'), errors: 1 },
        { code: cls('@api get cfg() { return this._c; } set cfg(v) { this._c = JSON.parse(JSON.stringify(v)); }'), errors: 1 },
        { code: cls('@api get cfg() { return this._c; } set cfg(v) { this._c = structuredClone(v); }'), errors: 1 }
    ]
});

tester.run('no-track-on-collections', plugin.rules['no-track-on-collections'], {
    valid: [cls('@track state = {};'), cls('rows = [];')],
    invalid: [
        { code: cls('@track rows = [];'), errors: 1 },
        { code: cls('@track records;'), errors: 1 },
        { code: cls('@track tableData = [];'), errors: 1 }
    ]
});

tester.run('no-reactive-write-in-rendered-callback', plugin.rules['no-reactive-write-in-rendered-callback'], {
    valid: [
        cls('renderedCallback() { this._measurements.h = 1; this._layout.x = 2; }'),
        cls('renderedCallback() { requestAnimationFrame(() => { this.rowHeight = 3; }); }'),
        cls('renderedCallback() { const x = this.el; x.focus(); }')
    ],
    invalid: [
        { code: cls('renderedCallback() { this.rowHeight = 3; }'), errors: 1 },
        { code: cls('renderedCallback() { this.count++; }'), errors: 1 },
        { code: cls('renderedCallback() { this.state.x = 1; }'), errors: 1 }
    ]
});

tester.run('no-queryselector-in-loop', plugin.rules['no-queryselector-in-loop'], {
    valid: [
        cls('f() { const all = this.template.querySelectorAll("td"); all.forEach(td => td.focus()); }'),
        cls('f() { return this.template.querySelector("[data-x]"); }')
    ],
    invalid: [
        { code: cls('f(rows) { for (const r of rows) { this.template.querySelector(r.id); } }'), errors: 1 },
        { code: cls('f(rows) { rows.forEach(r => this.template.querySelectorAll(r.id)); }'), errors: 1 },
        { code: cls('f(n) { let i = 0; while (i++ < n) { this.template.querySelector("x"); } }'), errors: 1 }
    ]
});

tester.run('no-shared-element-observer', plugin.rules['no-shared-element-observer'], {
    valid: [cls('f() { new ResizeObserver(() => {}).observe(this.template.querySelector("div")); }')],
    invalid: [
        { code: cls('f() { new ResizeObserver(() => {}).observe(document.body); }'), errors: 1 },
        { code: cls('f() { new IntersectionObserver(() => {}, { root: document.documentElement }); }'), errors: 1 }
    ]
});

console.log('eslint-plugin-rowhouse: all rule tests passed');
