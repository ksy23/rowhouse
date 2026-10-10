#!/usr/bin/env node
/**
 * Rowhouse static gates — every hard rule that a file scan can enforce.
 *
 * These were greps in the original CI workflow. They are Node here so they run
 * the same on a laptop, in CI and on Windows, and so each one can be tested
 * against a planted violation (scripts/checks/self-test.js). A check that has
 * never been seen to fail is not evidence of anything.
 *
 * Exit code 1 on any violation. Output names the rule, the file and the line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { checkTemplates } = require('./templates');

const ROOT = process.env.ROWHOUSE_ROOT || path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'force-app');

function files(dir, test) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : files(p, test);
        return test(p) ? [p] : [];
    });
}

const rel = p => path.relative(ROOT, p);
const violations = [];
const fail = (rule, file, line, message) => violations.push({ rule, file: rel(file), line, message });

/** Strip // and /* *\/ comments and string contents so a rule quoted in a comment is not a violation. */
function apexCode(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, '')
        .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

function eachLine(file, source, re, fn) {
    source.split('\n').forEach((line, i) => {
        if (re.test(line)) fn(i + 1, line.trim());
    });
}

const apexFiles = files(SRC, p => /\.(cls|trigger)$/.test(p));

// ---------------------------------------------------------------- HR-1
// Deliberately broad: `global with sharing class` and `webservice` members
// defeat a pattern that only looks for `global class`.
apexFiles.forEach(f => {
    eachLine(f, apexCode(fs.readFileSync(f, 'utf8')), /(^|[\s(])(global|webservice)\s/i, (n, l) =>
        fail('HR-1', f, n, 'global or webservice member — neither can ever be removed from a managed package: ' + l)
    );
});

// ---------------------------------------------------------------- HR-5
// Every FLS/CRUD decision and every access-mode choice lives in GridSecurity.
const ACCESS =
    /isUpdateable\s*\(|isCreateable\s*\(|isAccessible\s*\(|isDeletable\s*\(|stripInaccessible|AccessLevel\.|WITH\s+USER_MODE|\bas\s+(user|system)\b/i;
apexFiles
    .filter(f => !/GridSecurity(Test)?\.cls$/.test(f) && !/Test\.cls$/.test(f))
    .forEach(f => {
        eachLine(f, apexCode(fs.readFileSync(f, 'utf8')), ACCESS, (n, l) =>
            fail('HR-5', f, n, 'access decision outside GridSecurity: ' + l)
        );
    });

// ------------------------------------------------ system-mode escape hatch
apexFiles.forEach(f => {
    eachLine(
        f,
        apexCode(fs.readFileSync(f, 'utf8')),
        /AccessLevel\.SYSTEM_MODE|WITH\s+SYSTEM_MODE|\bas\s+system\b/i,
        (n, l) => fail('system-mode', f, n, 'system mode silently voids every FLS assertion in the Apex suite: ' + l)
    );
});

// ---------------------------------------------------------------- HR-8
apexFiles.forEach(f => {
    eachLine(f, apexCode(fs.readFileSync(f, 'utf8')), /WITH\s+SECURITY_ENFORCED/i, (n, l) =>
        fail('HR-8', f, n, 'WITH SECURITY_ENFORCED does not compile at API 67+: ' + l)
    );
    const meta = f + '-meta.xml';
    if (fs.existsSync(meta)) {
        const m = /<apiVersion>([\d.]+)<\/apiVersion>/.exec(fs.readFileSync(meta, 'utf8'));
        if (!m || Number(m[1]) < 67)
            fail(
                'HR-8',
                meta,
                1,
                'Apex must be pinned at API 67.0 or later (user mode by default); found ' + (m ? m[1] : 'none')
            );
    } else {
        fail('HR-8', f, 1, 'missing -meta.xml, so the API version is unknown');
    }
});

// ---------------------------------------------------------------- HR-9
apexFiles
    .filter(f => !/Test\.cls$/.test(f))
    .forEach(f => {
        eachLine(
            f,
            apexCode(fs.readFileSync(f, 'utf8')),
            /\bnew\s+Http(Request)?\s*\(|\bContinuation\b|WebServiceCallout|\bcallout:/i,
            (n, l) =>
                fail(
                    'HR-9',
                    f,
                    n,
                    'callout found — zero external services is both the architecture and the claim: ' + l
                )
        );
    });

// ---------------------------------------------------------------- HR-26
files(SRC, p => /staticresources/.test(p) && /\.(js|zip|mjs)$/i.test(p)).forEach(f =>
    fail('HR-26', f, 1, 'JavaScript static resource. No third-party JavaScript (a project rule, not a platform one).')
);

// ---------------------------------------------------------------- HR-2
// Only these components are exposed, each with exactly these @api members.
// Every @api member of an exposed component is permanent once released, so
// the count is checked, not just the flag. gridApp takes configName, and
// recordId, which Lightning sets on a record page. rowhouseAdmin, rowhouseGuide
// and rowhouseFlow are exposed only so they can be tabs or the page a
// screen-flow action runs on (lightning__UrlAddressable), with no @api member.
const EXPOSED = { gridApp: ['configName', 'recordId'], rowhouseAdmin: [], rowhouseFlow: [], rowhouseGuide: [] };
files(SRC, p => p.endsWith('.js-meta.xml')).forEach(f => {
    const xml = fs.readFileSync(f, 'utf8');
    const name = path.basename(f, '.js-meta.xml');
    if (/<isExposed>\s*false\s*<\/isExposed>/.test(xml)) return;
    if (!EXPOSED[name]) {
        fail(
            'HR-2',
            f,
            1,
            name +
                ' is exposed; only ' +
                Object.keys(EXPOSED).join(', ') +
                ' may be (an exposed @api property can never be removed)'
        );
        return;
    }
    const js = path.join(path.dirname(f), name + '.js');
    const code = fs.existsSync(js) ? apexCode(fs.readFileSync(js, 'utf8')) : '';
    const members = [...code.matchAll(/@api\s+(?:get\s+|set\s+|async\s+)?([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
    const unique = [...new Set(members)];
    if (unique.join() !== EXPOSED[name].join()) {
        fail(
            'HR-2',
            js,
            1,
            name + ' must expose exactly @api ' + EXPOSED[name].join(', ') + '; found ' + (unique.join(', ') || 'none')
        );
    }
});

// ---------------------------------------------------------------- HR-15
// SLDS Linter (npm run lint:slds) fails the build on its Error-severity rules,
// but in version 1.2.1 an override of an .slds-* class is only a warning and a
// --slds-c-* component hook is not reported at all (both checked).
// So both are checked here. Comments are stripped first: the rule may be quoted.
files(SRC, p => p.endsWith('.css')).forEach(f => {
    const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    eachLine(f, css, /\.slds-|--slds-c-/, (n, l) =>
        fail(
            'HR-15',
            f,
            n,
            'targets an SLDS class or a component-level hook; use an rh- class and global hooks only: ' + l
        )
    );
});

// ---------------------------------------------------------------- HR-3
// "Admin-editable" is a design decision, so it is recorded in a list. A CMDT
// field that is not in the list at all also fails: someone has to decide.
const listFile = path.join(__dirname, 'cmdt-admin-editable.json');
const decided = fs.existsSync(listFile)
    ? JSON.parse(fs.readFileSync(listFile, 'utf8'))
    : { adminEditable: [], developerControlled: [] };
files(path.join(SRC, 'main', 'default', 'objects'), p => /__mdt[\\/]fields[\\/].+\.field-meta\.xml$/.test(p)).forEach(
    f => {
        const id = path.basename(path.dirname(path.dirname(f))) + '.' + path.basename(f, '.field-meta.xml');
        const xml = fs.readFileSync(f, 'utf8');
        const m = /<fieldManageability>(\w+)<\/fieldManageability>/.exec(xml);
        const manageability = m ? m[1] : '(missing)';
        if (decided.adminEditable.includes(id)) {
            if (manageability !== 'SubscriberControlled')
                fail(
                    'HR-3',
                    f,
                    1,
                    id + ' is admin-editable, so it must be SubscriberControlled (found ' + manageability + ')'
                );
        } else if (decided.developerControlled.includes(id)) {
            if (manageability === 'SubscriberControlled')
                fail('HR-3', f, 1, id + ' is listed as developer-controlled but is SubscriberControlled');
        } else {
            fail(
                'HR-3',
                f,
                1,
                id + ' is not in scripts/checks/cmdt-admin-editable.json — decide whether admins edit it'
            );
        }
    }
);

// ---------------------------------------------------------------- HR-25
const kb = path.join(SRC, 'main', 'default', 'lwc', 'gridKeyboard');
files(kb, p => /\.(js|html)$/.test(p)).forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    if (f.endsWith('.html')) fail('HR-25', f, 1, 'gridKeyboard must stay a plain module: no template');
    eachLine(f, src, /extends\s+\w+\s*\(|=>\s*class\s+extends|\bMixin\b|\bLightningElement\b/, (n, l) =>
        fail('HR-25', f, n, 'keyboard layer must be a plain module, not a mixin or component: ' + l)
    );
});

// ---------------------------------------------------------------- HR-27
// The cell-editor library (lwc/cell*) must not depend on the table. Note the c/
// specifier: that is what LWC source uses, so a grep for the package namespace
// would never match anything.
const lwcDir = path.join(SRC, 'main', 'default', 'lwc');
const cellDirs = fs.existsSync(lwcDir)
    ? fs
          .readdirSync(lwcDir)
          .filter(d => /^cell[A-Z]/.test(d))
          .map(d => path.join(lwcDir, d))
    : [];
if (!cellDirs.length)
    fail('HR-27', lwcDir, 1, 'no lwc/cell* components found — the boundary check would pass vacuously');
cellDirs.forEach(dir =>
    files(dir, p => /\.(js|html)$/.test(p)).forEach(f => {
        eachLine(
            f,
            fs.readFileSync(f, 'utf8'),
            /from\s+['"]c\/(gridTable|gridKeyboard|gridEditState|gridApp)['"]|<c-grid-(table|app)\b/,
            (n, l) => fail('HR-27', f, n, 'a cell editor depends on the table: ' + l)
        );
    })
);

// ---------------------------------------------------------------- HR-23
// Lightning Locker has no BigInt (nor BigInt literals such as 10n): the code
// that used one threw as soon as it ran in an org with Locker. Tests may use
// it to check our own arithmetic; the components may not.
files(lwcDir, p => p.endsWith('.js') && !p.endsWith('.test.js')).forEach(f => {
    eachLine(f, apexCode(fs.readFileSync(f, 'utf8')), /\bBigInt\b|\b\d+n\b/, (n, l) =>
        fail('HR-23', f, n, 'BigInt is not available under Lightning Locker: ' + l)
    );
});

// ------------------------------------------------------- HR-19 and HR-22
checkTemplates(files(lwcDir, p => p.endsWith('.html'))).forEach(v => fail(v.rule, v.file, v.line, v.message));

// ------------------------------------------------------ the guide
// The Grid Guide's pages are built from guide/pages by guide/build.js. A built
// file that differs from what the build would write means its page changed
// without npm run guide, or someone edited the build's output by hand.
const guideBuild = path.join(ROOT, 'guide', 'build.js');
let guideFiles = 0;
if (fs.existsSync(guideBuild)) {
    const { build } = require(guideBuild);
    const { files: built, problems } = build();
    problems.forEach(p => fail('guide-build', guideBuild, 1, p));
    Object.entries(built).forEach(([f, content]) => {
        guideFiles++;
        const now = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
        if (now !== content)
            fail(
                'guide-build',
                f,
                1,
                'is not what guide/build.js writes from guide/pages: change the page, then run npm run guide'
            );
    });
}

// --------------------------------------------- scheduled classes
// While a job is scheduled, Salesforce refuses to deploy the scheduled class
// and every class it names in its code. So a class Rowhouse schedules names
// no other Rowhouse class: it finds them by name, as text (Type.forName), and
// a scheduled clean-up never stops Rowhouse being updated.
const byName = new Map(apexFiles.map(f => [path.basename(f).replace(/\.(cls|trigger)$/, ''), f]));
const scheduled = new Set();
apexFiles.forEach(f => {
    for (const m of apexCode(fs.readFileSync(f, 'utf8')).matchAll(/System\.schedule\s*\([^;]*?new\s+(\w+)\s*\(/g))
        scheduled.add(m[1]);
});
scheduled.forEach(name => {
    const f = byName.get(name);
    if (!f) return;
    eachLine(f, apexCode(fs.readFileSync(f, 'utf8')), /\w/, (n, l) => {
        const named = [...new Set((l.match(/\b[A-Za-z_]\w*\b/g) || []).filter(w => w !== name && byName.has(w)))];
        if (named.length)
            fail(
                'scheduled-class',
                f,
                n,
                `is scheduled, so it may not name another Rowhouse class (${named.join(', ')}): while the job is scheduled Salesforce would refuse to deploy it. Find it by name with Type.forName instead.`
            );
    });
});

// ----------------------------------------------------- dev-only
// Nothing under test-data/ or dev/ is packaged. Each component
// there that has a description starts it with DEVELOPMENT ONLY., and each
// Apex class there says so first in its header, so nobody mistakes it for part
// of Rowhouse in an org's Setup. scripts/mark-dev-only.py adds the words.
const DEV_ONLY = 'DEVELOPMENT ONLY.';
const DESCRIBED = /\.(object|field|permissionset|flow|tab|flexipage|js)-meta\.xml$/;
let devOnlyFiles = 0;
['test-data', 'dev'].forEach(dir => {
    files(path.join(ROOT, dir), p => DESCRIBED.test(p) || p.endsWith('.cls')).forEach(f => {
        devOnlyFiles++;
        const source = fs.readFileSync(f, 'utf8');
        if (f.endsWith('.cls')) {
            if (!/^\/\*\*\s*\n\s*\*\s*DEVELOPMENT ONLY\./.test(source))
                fail(
                    'dev-only',
                    f,
                    1,
                    `never packaged: its header comment must start with ${DEV_ONLY} (python3 scripts/mark-dev-only.py)`
                );
            return;
        }
        const m = /<description>\s*([\s\S]*?)<\/description>/.exec(source);
        if (!m || !m[1].startsWith(DEV_ONLY))
            fail(
                'dev-only',
                f,
                1,
                `never packaged: its description must start with ${DEV_ONLY} (python3 scripts/mark-dev-only.py)`
            );
    });
});

// ---------------------------------------------------------------- report
if (violations.length) {
    violations.forEach(v => console.error(`::error file=${v.file},line=${v.line}::${v.rule} ${v.message}`));
    console.error(`\n${violations.length} hard-rule violation(s).`);
    process.exit(1);
}
console.log(
    `Static gates passed: HR-1, HR-2, HR-3, HR-5, HR-8, HR-9, HR-15, HR-19, HR-22, HR-23, HR-25, HR-26, HR-27, system-mode (${apexFiles.length} Apex files, ${cellDirs.length} cell editors), the Grid Guide matches its pages (${guideFiles} files), no scheduled class names another (${scheduled.size} scheduled), and every development-only component says so (${devOnlyFiles} files).`
);
