/**
 * HR-20 — never write reactive state in renderedCallback. Rerender is queued as
 * a microtask, so a reactive write there can loop forever. Measurements go into
 * an explicitly non-reactive container; layout writes are deferred with
 * requestAnimationFrame (callbacks are nested functions, which this rule skips).
 *
 * Limitation, stated plainly: the rule sees renderedCallback's own body only.
 * A helper it calls is not followed.
 */
'use strict';
const { walk } = require('./util');

const DEFAULT_ALLOW = ['_measurements', '_layout'];

function rootThisProperty(target) {
    let n = target;
    while (n && n.type === 'MemberExpression' && n.object.type === 'MemberExpression') n = n.object;
    if (n && n.type === 'MemberExpression' && n.object.type === 'ThisExpression' && !n.computed) return n.property.name;
    return null;
}

module.exports = {
    meta: {
        type: 'problem',
        docs: { description: 'Disallow reactive writes in renderedCallback (HR-20)' },
        schema: [
            {
                type: 'object',
                properties: { allow: { type: 'array', items: { type: 'string' } } },
                additionalProperties: false
            }
        ],
        messages: {
            write: 'HR-20: renderedCallback writes this.{{name}}. Use a non-reactive container ({{allowed}}) or defer with requestAnimationFrame.'
        }
    },
    create(context) {
        const allow = new Set((context.options[0] && context.options[0].allow) || DEFAULT_ALLOW);
        return {
            MethodDefinition(m) {
                if (m.key.type !== 'Identifier' || m.key.name !== 'renderedCallback') return;
                walk(
                    m.value.body,
                    n => {
                        const target =
                            n.type === 'AssignmentExpression'
                                ? n.left
                                : n.type === 'UpdateExpression'
                                  ? n.argument
                                  : null;
                        if (!target) return;
                        const name = rootThisProperty(target);
                        if (name && !allow.has(name)) {
                            context.report({
                                node: n,
                                messageId: 'write',
                                data: { name, allowed: [...allow].map(a => 'this.' + a).join(', ') }
                            });
                        }
                    },
                    true
                );
            }
        };
    }
};
