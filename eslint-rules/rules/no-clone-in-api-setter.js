/**
 * HR-17 — never clone an array or object inside an @api setter.
 *
 * Cloning there means the parent can mutate the array in place, the reference
 * never changes, the setter never fires, and the child silently shows stale data
 * (lwc#4341, no fix coming). Assign the reference; normalise in a getter.
 */
'use strict';
const { decoratorName, keyName, walk, isIdent, isMember } = require('./util');

const CLONING_METHODS = new Set([
    'slice',
    'map',
    'concat',
    'filter',
    'flat',
    'flatMap',
    'toSorted',
    'toReversed',
    'toSpliced',
    'with'
]);

module.exports = {
    meta: {
        type: 'problem',
        docs: { description: 'Disallow cloning the incoming value inside an @api setter (HR-17)' },
        schema: [],
        messages: {
            clone: 'HR-17: "{{how}}" clones the @api setter value "{{param}}". Assign the reference and normalise in a getter.'
        }
    },
    create(context) {
        return {
            ClassBody(body) {
                const apiNames = new Set();
                body.body.forEach(m => {
                    if ((m.decorators || []).some(d => decoratorName(d) === 'api')) apiNames.add(keyName(m.key));
                });
                body.body.forEach(m => {
                    if (m.type !== 'MethodDefinition' || m.kind !== 'set' || !apiNames.has(keyName(m.key))) return;
                    const param = m.value.params[0];
                    if (!param || param.type !== 'Identifier') return;
                    const p = param.name;
                    const report = (node, how) => context.report({ node, messageId: 'clone', data: { how, param: p } });
                    walk(m.value.body, n => {
                        if (n.type === 'SpreadElement' && isIdent(n.argument, p)) report(n, '...' + p);
                        if (n.type !== 'CallExpression') return;
                        const c = n.callee;
                        const args = n.arguments;
                        if (isMember(c, 'Array', 'from') && isIdent(args[0], p)) report(n, 'Array.from');
                        if (isMember(c, 'Object', 'assign') && args.slice(1).some(a => isIdent(a, p)))
                            report(n, 'Object.assign');
                        if (isIdent(c, 'structuredClone') && isIdent(args[0], p)) report(n, 'structuredClone');
                        if (
                            c.type === 'MemberExpression' &&
                            isIdent(c.object, p) &&
                            !c.computed &&
                            CLONING_METHODS.has(c.property.name)
                        ) {
                            report(n, p + '.' + c.property.name + '()');
                        }
                        if (
                            isMember(c, 'JSON', 'parse') &&
                            args[0] &&
                            args[0].type === 'CallExpression' &&
                            isMember(args[0].callee, 'JSON', 'stringify') &&
                            isIdent(args[0].arguments[0], p)
                        ) {
                            report(n, 'JSON.parse(JSON.stringify())');
                        }
                    });
                });
            }
        };
    }
};
