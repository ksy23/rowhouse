/**
 * HR-18 — no @track on the row array. @track routes every object touched through
 * an observable-membrane proxy; on ten thousand rows that is the threshold at
 * which Salesforce says the cost becomes observable, and LWS multiplies it.
 */
'use strict';
const { decoratorName, keyName } = require('./util');

const COLLECTION = /rows?|data|records|items/i;

module.exports = {
    meta: {
        type: 'problem',
        docs: { description: 'Disallow @track on collection-like fields (HR-18)' },
        schema: [],
        messages: { track: 'HR-18: @track on "{{name}}". Reassign a new array reference instead.' }
    },
    create(context) {
        const check = node => {
            const name = keyName(node.key);
            if (name && COLLECTION.test(name) && (node.decorators || []).some(d => decoratorName(d) === 'track')) {
                context.report({ node, messageId: 'track', data: { name } });
            }
        };
        return { PropertyDefinition: check, ClassProperty: check };
    }
};
