/**
 * The two template rules ESLint cannot see, because ESLint never parses .html.
 *
 * HR-19 no index as key. The LWC template compiler already reports this as
 * LWC1065 / LWC1066, so the check simply runs the compiler's parser and fails on
 * those diagnostics — the earliest possible point, before a deploy.
 *
 * HR-22 no <slot> as an immediate child of table, thead, tbody, tfoot or tr.
 * This one CANNOT be checked on the compiler's AST: the HTML parser foster-parents the slot out of the table before the
 * AST exists (the defect itself, lwc#265), so in the AST the slot is no longer
 * inside the table at all. It is checked on the raw tag stream instead.
 * <template> wrappers are transparent: their nearest real ancestor counts.
 */
'use strict';
const fs = require('fs');
const { parse } = require('@lwc/template-compiler');

const TABLE_PARENTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function lineOf(source, index) {
    return source.slice(0, index).split('\n').length;
}

function slotInTable(source) {
    const out = [];
    const stack = [];
    const noComments = source.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
    const re = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
    let m;
    while ((m = re.exec(noComments))) {
        const [, closing, rawName, , selfClosing] = m;
        const name = rawName.toLowerCase();
        if (closing) {
            const i = stack.lastIndexOf(name);
            if (i >= 0) stack.length = i;
            continue;
        }
        if (name === 'slot') {
            const parent = [...stack].reverse().find(t => t !== 'template');
            if (parent && TABLE_PARENTS.has(parent)) {
                out.push({ line: lineOf(source, m.index), parent });
            }
        }
        if (!selfClosing && !VOID.has(name)) stack.push(name);
    }
    return out;
}

function checkTemplates(files) {
    const violations = [];
    files.forEach(file => {
        const source = fs.readFileSync(file, 'utf8');
        slotInTable(source).forEach(v => violations.push({
            rule: 'HR-22', file, line: v.line,
            message: `<slot> directly inside <${v.parent}> — the parser hoists it out of the table (lwc#265). Project columns by iterating config.`
        }));
        let result;
        try {
            result = parse(source, {});
        } catch (e) {
            violations.push({ rule: 'template', file, line: 1, message: 'template failed to parse: ' + e.message });
            return;
        }
        (result.warnings || []).forEach(w => {
            const code = String(w.code || '');
            const isKeyIndex = /LWC106[56]/.test(code) || /Key cannot reference/.test(w.message);
            if (isKeyIndex || w.level === 0 || w.level === 'error' || w.level === 1) {
                violations.push({
                    rule: isKeyIndex ? 'HR-19' : 'template',
                    file,
                    line: w.location ? w.location.line : 1,
                    message: w.message
                });
            }
        });
    });
    return violations;
}

module.exports = { checkTemplates, slotInTable };
