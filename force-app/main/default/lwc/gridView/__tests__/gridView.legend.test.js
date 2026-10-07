/**
 * The Display Key's samples repeat gridTable's format colors, because
 * each component's styles are its own. This keeps the two the same: every
 * look c/gridFormatRules can give has a sample, in the table's color.
 */
import { STYLES } from 'c/gridFormatRules';

/* global require, __dirname -- Jest runs in Node, where the test reads the stylesheets. */
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const table = read('gridTable/gridTable.css');
const view = read('gridView/gridView.css');

/** The declarations of every rule that names `cls`, as one string, spaces collapsed. */
function declarationsFor(css, cls) {
    const out = [];
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
        const selectors = m[1].split(',').map(s => s.trim());
        if (selectors.some(s => new RegExp('\\.' + cls + '(?![\\w-])').test(s))) {
            out.push(m[2].replace(/\s+/g, ' ').trim());
        }
    }
    return out;
}

const classes = [...new Set(Object.values(STYLES).flatMap(s => [s.cls, s.bar]).filter(Boolean))];

describe('the Display Key matches the table', () => {
    it.each(classes)('%s looks the same in the key as in the grid', cls => {
        const inTable = declarationsFor(table, cls);
        const inView = declarationsFor(view, cls);
        expect(inView.length).toBeGreaterThan(0);
        // Every declaration the key gives this class, the table gives it too.
        inView.forEach(d => expect(inTable).toContain(d));
    });
});
