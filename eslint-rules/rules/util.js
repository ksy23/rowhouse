'use strict';

/** Name of a decorator: @api -> 'api', @track -> 'track', @wire(x) -> 'wire'. */
function decoratorName(d) {
    const e = d.expression;
    if (e.type === 'Identifier') return e.name;
    if (e.type === 'CallExpression' && e.callee.type === 'Identifier') return e.callee.name;
    return null;
}

function keyName(key) {
    if (!key) return null;
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'Literal') return String(key.value);
    return null;
}

/** Walk every descendant of `node`, calling visit(child, parent). */
function walk(node, visit, skipFunctions = false) {
    const stack = [node];
    while (stack.length) {
        const n = stack.pop();
        for (const k of Object.keys(n)) {
            if (k === 'parent' || k === 'loc' || k === 'range') continue;
            const v = n[k];
            const children = Array.isArray(v) ? v : [v];
            for (const c of children) {
                if (c && typeof c.type === 'string') {
                    if (skipFunctions && /Function/.test(c.type)) continue;
                    visit(c, n);
                    stack.push(c);
                }
            }
        }
    }
}

const isIdent = (n, name) => n && n.type === 'Identifier' && n.name === name;
const isMember = (n, obj, prop) =>
    n && n.type === 'MemberExpression' && isIdent(n.object, obj) && !n.computed && isIdent(n.property, prop);

module.exports = { decoratorName, keyName, walk, isIdent, isMember };
