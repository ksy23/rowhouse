#!/usr/bin/env node
/**
 * Builds the Grid Guide: one Lightning web component per page of
 * guide/pages, whose template IS the page, plus c/guideContent (which page to
 * show) and c/guideCatalog (the list of pages).
 *
 *   npm run guide            write the components
 *   npm run guide -- --check fail if a component differs from its page
 *                            (scripts/checks/run-all.js runs this)
 *
 * WHAT A PAGE MAY CONTAIN
 * Plain HTML and SVG, as the template compiler accepts it, with two macros:
 *   {{ic:name}}           one of the line icons below
 *   {{fields:Object__mdt}} the field table of a configuration record, read
 *                          from its metadata here, so it matches Setup
 * and a first line <!--meta {"title", "desc", "section", "audience"} -->,
 * where audience is "admin" (Rowhouse Grid Admin) or "all".
 *
 * WHAT THE BUILD DOES TO A PAGE
 *  - prefixes every class and custom property with rh- (HR-15), so
 *    class="tile sky" becomes class="rh-tile rh-sky" and var(--sky) var(--rh-sky);
 *  - escapes { and } in text, which a template would read as an expression;
 *  - gives every element with an id a data-anchor, which c/guidePageBase
 *    scrolls to (Lightning rewrites ids, so they cannot be looked up);
 *  - turns links between pages (start.html#access) into Grid Guide
 *    addresses, /lightning/n/Rowhouse_Guide?c__page=start&c__section=access,
 *    and a link within the page (#access) into a scroll;
 *  - points links to guide/files at their static resource;
 *  - adds pathLength="1" to drawn paths (class "draw"), so CSS draws them in
 *    without measuring them.
 * Everything else is left as written.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(__dirname, 'pages');
const LWC = path.join(ROOT, 'force-app', 'main', 'default', 'lwc');
const META = path.join(ROOT, 'force-app', 'main', 'default');
const API = JSON.parse(fs.readFileSync(path.join(ROOT, 'sfdx-project.json'), 'utf8')).sourceApiVersion;
const NAMESPACE = JSON.parse(fs.readFileSync(path.join(ROOT, 'sfdx-project.json'), 'utf8')).namespace || '';
const NS = NAMESPACE || 'c';
const TAB = (NAMESPACE ? NAMESPACE + '__' : '') + 'Rowhouse_Guide';

/** The order of the pages in the guide's navigation and catalog. */
const ORDER = [
    'welcome',
    'start',
    'configure',
    'features',
    'using',
    'tutorials',
    'tutorial-pipeline',
    'tutorial-service',
    'tutorial-accounts',
    'tutorial-contacts',
    'tutorial-cleanup',
    'reference'
];

/** Files a page may link to, and the static resource each one ships as. */
const FILES = {
    'files/event-attendees.csv': {
        resource: 'RowhouseSampleAttendees',
        constant: 'SAMPLE_ATTENDEES',
        prop: 'sampleAttendeesUrl',
        download: 'event-attendees.csv'
    }
};

const ICONS = {
    grid: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    keyboard:
        '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    palette:
        '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1.1.3-2.2 1.5-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    tree: '<rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="10" width="7" height="5" rx="1"/><rect x="14" y="17" width="7" height="4" rx="1"/><path d="M6.5 8v10.5H14M6.5 12.5H14"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 5.5 5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    page: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    formula: '<path d="M13 4h-1.5A2.5 2.5 0 0 0 9 6.5V20"/><path d="M5.5 11H12"/><path d="M14 12l6 7M20 12l-6 7"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
};

function icon(name) {
    if (!ICONS[name]) throw new Error('No icon called ' + name);
    return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        ICONS[name] +
        '</svg>'
    );
}

// ------------------------------------------------------------ field tables
// The Configuration reference's tables, read from the metadata so they always
// match what Setup shows. Label rows for the standard Label and Name fields,
// which have no field file.
const LABEL_ROWS = {
    Grid_Configuration__mdt: [
        "The grid's title, shown at the top of the grid.",
        'Grid Configuration Name',
        'The API name you enter in the Rowhouse Grid component in Lightning App Builder. Filled in from the Label.'
    ],
    Grid_Column__mdt: [
        "Names the record in Setup only; users never see it. Start it with the grid's name.",
        'Grid Column Name',
        'Unique across all Grid Column records.'
    ],
    Grid_Format_Rule__mdt: [
        "What the color means, in your words. Users see it in the Display Key, in the cell's tooltip, and screen readers read it.",
        'Grid Format Rule Name',
        'Unique across all Grid Format Rule records.'
    ],
    Grid_Child__mdt: [
        "Names the record in Setup. The tab shows Tab Label, or the child configuration's label.",
        'Grid Child Table Name',
        'Unique across all Grid Child Table records.'
    ],
    Grid_Action__mdt: [
        'What the menu item or button says.',
        'Grid Action Name',
        'Unique across all Grid Action records. Also what the audit log records.'
    ],
    Grid_Filter__mdt: [
        'Names the filter in Setup and on the Grid Admin tab (its Name, which the tab fills in from the field and condition when left blank). Users never see it: the grid shows the condition itself, such as "Email is not blank".',
        'Grid Filter Name',
        'Unique across all Grid Filter records.'
    ]
};

const xml = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: name => name === 'value' || name === 'layoutItems' || name === 'layoutColumns' || name === 'layoutSections'
});

function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function text(v) {
    return v === undefined || v === null ? '' : String(v);
}

function fieldRows(obj) {
    const base = path.join(META, 'objects', obj);
    const layouts = fs.readdirSync(path.join(META, 'layouts')).filter(f => f.startsWith(obj + '-'));
    const order = [];
    if (layouts.length) {
        const raw = fs.readFileSync(path.join(META, 'layouts', layouts[0]), 'utf8');
        for (const m of raw.matchAll(/<field>([^<]+)<\/field>/g)) order.push(m[1]);
    }
    const fields = {};
    for (const fn of fs.readdirSync(path.join(base, 'fields'))) {
        const f = xml.parse(fs.readFileSync(path.join(base, 'fields', fn), 'utf8')).CustomField;
        fields[text(f.fullName)] = f;
    }
    const names = order
        .filter(n => fields[n])
        .concat(
            Object.keys(fields)
                .filter(n => !order.includes(n))
                .sort()
        );
    return names.map(n => {
        const f = fields[n];
        const type = text(f.type);
        let def = text(f.defaultValue);
        const values = (((f.valueSet || {}).valueSetDefinition || {}).value || []).filter(v => v.label !== undefined);
        let tdesc;
        if (type === 'Checkbox') {
            tdesc = 'Checkbox';
            def = def === 'true' ? 'Ticked' : 'Not ticked';
        } else if (type === 'Picklist') {
            tdesc = 'Picklist';
            const d = values.filter(v => text(v.default) === 'true');
            def = d.length ? text(d[0].label) : '';
        } else if (type === 'MetadataRelationship') {
            tdesc =
                'Lookup to ' +
                (text(f.referenceTo).includes('Configuration') ? 'Grid Configuration' : text(f.referenceTo));
        } else if (type === 'Number') {
            tdesc = 'Number';
        } else if (type === 'LongTextArea') {
            tdesc = 'Long text';
        } else {
            tdesc = f.length !== undefined && text(f.length) ? 'Text (' + text(f.length) + ')' : type;
        }
        return {
            label: text(f.label),
            api: n,
            type: tdesc,
            def: def || '—',
            desc: text(f.description),
            values: values.map(v => text(v.label))
        };
    });
}

function fieldsTable(obj) {
    const rows = fieldRows(obj);
    const lr = LABEL_ROWS[obj];
    const out = [
        `<div class="tbox"><table class="ref" id="ref-${obj}"><thead><tr><th>Field</th><th>Type</th><th>Default</th><th>What it does</th></tr></thead><tbody>`
    ];
    if (lr) {
        out.push(
            `<tr><td>Label</td><td class="d">Text (40)</td><td class="d">—</td><td>${esc(lr[0])} Required.</td></tr>`
        );
        out.push(
            `<tr><td>${lr[1]}</td><td class="d">Text (40)</td><td class="d">—</td><td>${esc(lr[2])} Required.</td></tr>`
        );
    }
    for (const r of rows) {
        const vals = r.values.length
            ? '<div class="pill-row pill-row-ref">' +
              r.values.map(v => `<span class="ptag">${esc(v)}</span>`).join('') +
              '</div>'
            : '';
        out.push(
            `<tr><td>${esc(r.label)}<br><code>${r.api}</code></td><td class="d">${esc(r.type)}</td><td class="d">${esc(r.def)}</td><td>${esc(r.desc)}${vals}</td></tr>`
        );
    }
    out.push('</tbody></table></div>');
    return out.join('\n');
}

// ------------------------------------------------------------ the transform
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(raw) {
    const out = [];
    let m;
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(raw))) {
        const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
        out.push([m[1], value]);
    }
    return out;
}

/** --name to --rh-name, in a style, fill or stroke value. */
function prefixVars(v) {
    return v.replace(/--(?!rh-|slds-)([a-zA-Z][\w-]*)/g, '--rh-$1');
}

/** As c/guideRoute's guideUrl: Welcome has no page key. */
function pageUrl(page, section) {
    const params = [];
    if (page !== ORDER[0]) params.push(`${NS}__page=${page}`);
    if (section) params.push(`${NS}__section=${section}`);
    return `/lightning/n/${TAB}` + (params.length ? '?' + params.join('&amp;') : '');
}

function transform(id, body, problems) {
    const used = { files: new Set() };
    let out = '';
    let last = 0;
    TAG.lastIndex = 0;
    let m;
    const escText = t => t.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
    while ((m = TAG.exec(body))) {
        out += escText(body.slice(last, m.index));
        last = TAG.lastIndex;
        if (m[0].startsWith('<!--')) {
            out += m[0];
            continue;
        }
        const [, closing, name, rawAttrs, selfClosing] = m;
        if (closing) {
            out += m[0];
            continue;
        }
        const attrs = parseAttrs(rawAttrs);
        const next = [];
        let isDraw = false;
        for (const [k, v] of attrs) {
            if (v !== undefined && /[{}]/.test(v))
                problems.push(`${id}: a brace in ${k}="${v}" would be read as an expression`);
            if (k === 'class') {
                const classes = v.split(/\s+/).filter(Boolean);
                if (classes.includes('draw')) isDraw = true;
                next.push([k, classes.map(c => (c.startsWith('rh-') ? c : 'rh-' + c)).join(' ')]);
            } else if (k === 'style' || k === 'fill' || k === 'stroke') {
                next.push([k, prefixVars(v)]);
            } else if (k === 'id') {
                next.push([k, v]);
                next.push(['data-anchor', v]);
            } else if (k === 'download') {
                next.push([k, v || (FILES[(attrs.find(([a]) => a === 'href') || [])[1]] || {}).download]);
            } else if (k === 'href') {
                const file = FILES[v];
                const link = /^([a-z0-9-]+)\.html(?:#([\w-]+))?$/.exec(v || '');
                if (file) {
                    used.files.add(v);
                    next.push(['href', '{' + file.prop + '}']);
                    if (!attrs.some(([a]) => a === 'download')) next.push(['download', file.download]);
                } else if (v && v.startsWith('#')) {
                    next.push([k, v]);
                    next.push(['data-anchor-link', v.slice(1)]);
                } else if (link) {
                    if (!ORDER.includes(link[1]))
                        problems.push(`${id}: links to ${v}, which is not a page of the guide`);
                    next.push(['href', pageUrl(link[1], link[2])]);
                    next.push(['data-page', link[1]]);
                    if (link[2]) next.push(['data-section', link[2]]);
                } else {
                    problems.push(`${id}: a link the guide cannot follow: ${v}`);
                    next.push([k, v]);
                }
            } else {
                next.push([k, v]);
            }
        }
        if (name.toLowerCase() === 'button' && !attrs.some(([k]) => k === 'type')) next.push(['type', 'button']);
        if (isDraw && !attrs.some(([k]) => k === 'pathLength')) next.push(['pathLength', '1']);
        const attrText = next
            .map(([k, v]) => {
                if (v === undefined) return ' ' + k;
                if (/^\{[\w.]+\}$/.test(v)) return ` ${k}=${v}`;
                return ` ${k}="${v}"`;
            })
            .join('');
        out += `<${name}${attrText}${selfClosing ? '/' : ''}>`;
    }
    out += escText(body.slice(last));
    return { html: out, used };
}

function pascal(id) {
    return id
        .split('-')
        .map(p => p[0].toUpperCase() + p.slice(1))
        .join('');
}

function componentOf(id) {
    return 'guidePage' + pascal(id);
}

const GENERATED = 'Generated by guide/build.js from guide/pages/';

function readPage(id) {
    const src = fs.readFileSync(path.join(PAGES, id + '.html'), 'utf8');
    const m = /^\s*<!--meta\s+(\{[\s\S]*?\})\s*-->/.exec(src);
    if (!m) throw new Error(id + '.html: missing <!--meta {...} --> header');
    const meta = JSON.parse(m[1]);
    for (const k of ['title', 'desc', 'section', 'audience']) {
        if (!meta[k]) throw new Error(`${id}.html: meta has no ${k}`);
    }
    if (!['admin', 'all'].includes(meta.audience)) throw new Error(`${id}.html: audience is "admin" or "all"`);
    return { meta, body: src.slice(m[0].length) };
}

function indent(s, n) {
    const pad = ' '.repeat(n);
    return s
        .split('\n')
        .map(l => (l.trim() ? pad + l : l))
        .join('\n');
}

function metaXml(description) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${API}</apiVersion>
    <description>${esc(description)}</description>
    <isExposed>false</isExposed>
</LightningComponentBundle>
`;
}

function build() {
    const files = {};
    const problems = [];
    const pages = [];
    const present = fs
        .readdirSync(PAGES)
        .filter(f => f.endsWith('.html'))
        .map(f => f.slice(0, -5));
    for (const id of present)
        if (!ORDER.includes(id)) problems.push(`guide/pages/${id}.html is not in ORDER in guide/build.js`);
    for (const id of ORDER) {
        if (!present.includes(id)) {
            problems.push(`guide/pages/${id}.html is missing`);
            continue;
        }
        const { meta, body } = readPage(id);
        let html = body
            .replace(/\{\{ic:([a-z]+)\}\}/g, (_, n) => icon(n))
            .replace(/\{\{fields:([A-Za-z_]+)\}\}/g, (_, o) => fieldsTable(o));
        const anchors = [...html.matchAll(/<section[^>]*\sid="([\w-]+)"/g)].map(a => a[1]);
        const { html: out, used } = transform(id, html, problems);
        const name = componentOf(id);
        const dir = path.join(LWC, name);
        files[path.join(dir, name + '.html')] =
            `<template>\n    <!-- ${GENERATED}${id}.html. Change the page, then run npm run guide. -->\n` +
            `    <div class="rh-page" onclick={handleClick}>\n${indent(out.trim(), 8)}\n    </div>\n</template>\n`;
        const imports = [...used.files].map(
            f => `import ${FILES[f].constant} from '@salesforce/resourceUrl/${FILES[f].resource}';`
        );
        const props = [...used.files].map(f => `    ${FILES[f].prop} = ${FILES[f].constant};`);
        files[path.join(dir, name + '.js')] =
            `// ${GENERATED}${id}.html. Change the page, then run npm run guide.\n` +
            `import GuidePage from 'c/guidePageBase';\n${imports.join('\n')}${imports.length ? '\n' : ''}\n` +
            `/** The Grid Guide page "${meta.title}". */\n` +
            `export default class ${pascal(name)} extends GuidePage${props.length ? ` {\n${props.join('\n')}\n}` : ' {}'}\n`;
        files[path.join(dir, name + '.css')] =
            `/* ${GENERATED}${id}.html. The guide's one stylesheet: */\n@import 'c/guideStyles';\n`;
        files[path.join(dir, name + '.js-meta.xml')] = metaXml(
            `Grid Guide page: ${meta.title}. ${GENERATED}${id}.html.`
        );
        pages.push({
            id,
            title: meta.title,
            desc: meta.desc,
            section: meta.section,
            audience: meta.audience,
            component: name,
            anchors
        });
    }

    // c/guideCatalog: the pages, in order, for the tab and for help links.
    files[path.join(LWC, 'guideCatalog', 'guideCatalog.js')] =
        `// ${GENERATED}*.html. Change the pages, then run npm run guide.\n` +
        `/**\n * The Grid Guide's pages, in order: id, title, description, the\n` +
        ` * navigation entry it belongs to, who it is for ("admin" or "all"), and the\n` +
        ` * sections a help link may open it at.\n */\n` +
        `export const PAGES = ${JSON.stringify(
            pages.map(({ component, ...p }) => p),
            null,
            4
        )};\n\n` +
        `/** A page by its id, or undefined. */\nexport function pageOf(id) {\n    return PAGES.find(p => p.id === id);\n}\n`;
    files[path.join(LWC, 'guideCatalog', 'guideCatalog.js-meta.xml')] = metaXml(
        `The Grid Guide's list of pages. ${GENERATED}*.html.`
    );

    // c/guideContent: which page to show.
    const branches = pages
        .map((p, i) => {
            const tag = 'c-' + p.component.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
            const directive = i === 0 ? 'lwc:if' : 'lwc:elseif';
            return `    <template ${directive}={is${pascal(p.id)}}>\n        <${tag} section={section}></${tag}>\n    </template>`;
        })
        .join('\n');
    files[path.join(LWC, 'guideContent', 'guideContent.html')] =
        `<template>\n    <!-- ${GENERATED}*.html. Change the pages, then run npm run guide. -->\n${branches}\n</template>\n`;
    files[path.join(LWC, 'guideContent', 'guideContent.js')] =
        `// ${GENERATED}*.html. Change the pages, then run npm run guide.\n` +
        `import { LightningElement, api } from 'lwc';\n\n` +
        `/** Shows one Grid Guide page, by id, opened at a section. */\n` +
        `export default class GuideContent extends LightningElement {\n` +
        `    /** The page's id, from c/guideCatalog. */\n    @api page;\n` +
        `    /** The section to open it at, or nothing for the top. */\n    @api section;\n\n` +
        pages.map(p => `    get is${pascal(p.id)}() {\n        return this.page === '${p.id}';\n    }`).join('\n\n') +
        `\n}\n`;
    files[path.join(LWC, 'guideContent', 'guideContent.js-meta.xml')] = metaXml(
        `Shows one Grid Guide page. ${GENERATED}*.html.`
    );

    // The files pages link to, as static resources (their -meta.xml is written by hand).
    for (const [rel, f] of Object.entries(FILES)) {
        files[path.join(META, 'staticresources', f.resource + '.resource')] = fs.readFileSync(
            path.join(__dirname, rel),
            'utf8'
        );
    }
    return { files, problems };
}

function main() {
    const check = process.argv.includes('--check');
    const { files, problems } = build();
    if (problems.length) {
        problems.forEach(p => console.error('guide: ' + p));
        process.exit(1);
    }
    const stale = [];
    for (const [file, content] of Object.entries(files)) {
        const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        if (now === content) continue;
        stale.push(path.relative(ROOT, file));
        if (!check) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        }
    }
    // A page component whose page is gone.
    const expected = new Set(Object.keys(files).map(f => path.basename(path.dirname(f))));
    const orphans = fs.readdirSync(LWC).filter(d => /^guidePage(?!Base$)[A-Z]/.test(d) && !expected.has(d));
    if (check) {
        const all = stale.concat(orphans.map(o => `force-app/main/default/lwc/${o} (no page)`));
        if (all.length) {
            all.forEach(f => console.error('guide: out of date: ' + f));
            console.error('guide: run npm run guide');
            process.exit(1);
        }
        console.log(`guide: ${Object.keys(files).length} files match guide/pages`);
    } else {
        orphans.forEach(o => console.error(`guide: force-app/main/default/lwc/${o} has no page any more; remove it`));
        console.log(`guide: ${Object.keys(files).length} files, ${stale.length} written`);
    }
}

if (require.main === module) main();
module.exports = { build, transform, pageUrl, ORDER };
