/**
 * HR-21 — never call querySelector / querySelectorAll per row. lwc:ref is a
 * compile error inside for:each (LWC1158), and querySelectorAll on large trees
 * leaks under Lightning Locker with no workaround but LWS — the subscriber's
 * choice, not ours. So: no DOM query inside any loop or iteration callback.
 */
'use strict';

const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const ITERATORS = new Set([
    'forEach',
    'map',
    'reduce',
    'reduceRight',
    'filter',
    'some',
    'every',
    'find',
    'findIndex',
    'flatMap'
]);

module.exports = {
    meta: {
        type: 'problem',
        docs: { description: 'Disallow querySelector/querySelectorAll inside loops (HR-21)' },
        schema: [],
        messages: { loop: 'HR-21: {{method}}() inside a loop. Query once per render pass, outside the loop.' }
    },
    create(context) {
        return {
            CallExpression(node) {
                const c = node.callee;
                if (c.type !== 'MemberExpression' || c.computed) return;
                const method = c.property.name;
                if (method !== 'querySelector' && method !== 'querySelectorAll') return;
                const ancestors = context.sourceCode.getAncestors(node);
                for (let i = ancestors.length - 1; i >= 0; i--) {
                    const a = ancestors[i];
                    if (LOOPS.has(a.type)) {
                        context.report({ node, messageId: 'loop', data: { method } });
                        return;
                    }
                    if (/Function/.test(a.type)) {
                        const parent = ancestors[i - 1];
                        if (
                            parent &&
                            parent.type === 'CallExpression' &&
                            parent.arguments.includes(a) &&
                            parent.callee.type === 'MemberExpression' &&
                            ITERATORS.has(parent.callee.property.name)
                        ) {
                            context.report({ node, messageId: 'loop', data: { method } });
                        }
                        return; // any other function boundary ends the search
                    }
                }
            }
        };
    }
};
