/**
 * HR-24 — never pass <html>, <head> or <body> to an observer, or as an
 * IntersectionObserver root. Lightning Web Security throws LockerSecurityError
 * on shared elements. Observe our own scroll container, or omit `root`.
 */
'use strict';
const { isIdent } = require('./util');

const SHARED = new Set(['body', 'documentElement', 'head']);
const isShared = n => n && n.type === 'MemberExpression' && isIdent(n.object, 'document') && !n.computed && SHARED.has(n.property.name);

module.exports = {
    meta: {
        type: 'problem',
        docs: { description: 'Disallow observing shared elements (HR-24)' },
        schema: [],
        messages: { shared: 'HR-24: {{what}} is a shared element. Observe the component\'s own scroll container instead.' }
    },
    create(context) {
        return {
            CallExpression(node) {
                const c = node.callee;
                if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'observe' && isShared(node.arguments[0])) {
                    context.report({ node, messageId: 'shared', data: { what: 'document.' + node.arguments[0].property.name } });
                }
            },
            NewExpression(node) {
                if (!isIdent(node.callee, 'IntersectionObserver')) return;
                const opts = node.arguments[1];
                if (!opts || opts.type !== 'ObjectExpression') return;
                opts.properties.forEach(p => {
                    if (p.type === 'Property' && isIdent(p.key, 'root') && isShared(p.value)) {
                        context.report({ node: p, messageId: 'shared', data: { what: 'root: document.' + p.value.property.name } });
                    }
                });
            }
        };
    }
};
