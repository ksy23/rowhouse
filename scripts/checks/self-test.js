#!/usr/bin/env node
/**
 * Plants one violation of each rule in a scratch tree and asserts that
 * run-all.js reports it. A gate nobody has seen fail proves nothing.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rowhouse-checks-'));
const w = (p, s) => {
    fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true });
    fs.writeFileSync(path.join(tmp, p), s);
};
const cls = (name, body, api = '68.0') => {
    w(`force-app/main/default/classes/${name}.cls`, body);
    w(`force-app/main/default/classes/${name}.cls-meta.xml`, `<ApexClass><apiVersion>${api}</apiVersion></ApexClass>`);
};

cls('A', 'global with sharing class A {}'); // HR-1
cls('B', 'public class B { void f() { Schema.SObjectType t; t.getDescribe().isUpdateable(); } }'); // HR-5
cls('C', 'public class C { void f() { Database.query(q, AccessLevel.SYSTEM_MODE); } }'); // system-mode (+HR-5)
cls('D', 'public class D { void f() { List<Account> a = [SELECT Id FROM Account WITH SECURITY_ENFORCED]; } }'); // HR-8
cls('E', 'public class E {}', '66.0'); // HR-8 api version
cls('F', 'public class F { void f() { new HttpRequest(); } }'); // HR-9
cls('G', "// global is fine in a comment\npublic with sharing class G { String s = 'global '; }"); // must NOT fire
// HR-5: queries, saves and custom permission checks only in GridSecurity; every class with sharing.
cls('J', 'public with sharing class J { List<Account> f() { return [SELECT Id FROM Account]; } }'); // static query
cls('K', 'public with sharing class K { void f(List<Account> a) { Database.update(a, false); } }'); // Database DML
cls('L', 'public with sharing class L { void f(Account a) {\n    insert a;\n    if (a != null) update a;\n} }'); // DML
cls('M', "public with sharing class M { Boolean f() { return FeatureManagement.checkPermission('X'); } }"); // FM
cls('N', 'public class N {}'); // no sharing declared
// Inner classes, so only the without/inherited rule can catch them: the class each file declares is with sharing.
cls('O', 'public with sharing class O {\n    private without sharing class Inner {}\n}'); // without sharing
cls('P', 'public with sharing class P {\n    public inherited sharing class Inner {}\n}'); // inherited sharing
// system-mode and HR-9 inside a string literal.
cls('Q', "public with sharing class Q { String q = 'SELECT Id FROM Account' + ' WITH SYSTEM_MODE'; }");
cls('R', "public with sharing class R { String endpoint = 'callout:Some_Credential/path'; }");
// Must NOT fire: GridSecurity may query, save and check permissions; comments and
// strings that only mention them; a URL in a string; an inner class without a keyword.
cls(
    'GridSecurity',
    "public with sharing class GridSecurity {\n    List<SObject> q() { return Database.query('SELECT Id FROM Account'); }\n" +
        "    Boolean p() { return FeatureManagement.checkPermission('X'); }\n    void d(List<SObject> r) {\n        insert r;\n    }\n" +
        '    List<Account> s() { return [SELECT Id FROM Account]; }\n}'
);
cls(
    'S',
    'public with sharing class S {\n    // insert x; [SELECT Id FROM Account] FeatureManagement.checkPermission WITH SYSTEM_MODE callout:x\n' +
        "    String a = '[SELECT Id FROM Account] insert x; FeatureManagement.checkPermission';\n" +
        "    String u = 'https://example.com/a'; // a URL is not a comment\n" +
        '    Integer insertCount = 0;\n    void g() { GridSecurity.insertRecords(null); }\n    public class Inner {}\n}'
);
cls('H', "public with sharing class H { public static void go() { System.schedule('n', '0 0 2 * * ?', new I()); } }");
cls(
    'I',
    'public with sharing class I implements Schedulable { public void execute(SchedulableContext c) { H.go(); } }'
); // a scheduled class that names another
w('force-app/main/default/staticresources/lib.js', ''); // HR-26
w(
    'force-app/main/default/lwc/gridTable/gridTable.js-meta.xml',
    '<LightningComponentBundle><isExposed>true</isExposed></LightningComponentBundle>'
); // HR-2 wrong component
w(
    'force-app/main/default/lwc/gridApp/gridApp.js-meta.xml',
    '<LightningComponentBundle><isExposed>true</isExposed></LightningComponentBundle>'
);
w('force-app/main/default/lwc/gridApp/gridApp.js', 'export default class A { @api configName; @api height; }'); // HR-2 second @api member
w(
    'force-app/main/default/objects/Grid_Configuration__mdt/fields/Page_Size__c.field-meta.xml',
    '<CustomField><fieldManageability>DeveloperControlled</fieldManageability></CustomField>'
); // HR-3
w(
    'force-app/main/default/objects/Grid_Configuration__mdt/fields/Mystery__c.field-meta.xml',
    '<CustomField><fieldManageability>SubscriberControlled</fieldManageability></CustomField>'
); // HR-3 undecided
w('force-app/main/default/lwc/gridKeyboard/gridKeyboard.js', 'export default (Base) => class extends Base {};'); // HR-25
w('force-app/main/default/lwc/cellText/cellText.js', "import GridTable from 'c/gridTable';"); // HR-27
w(
    'force-app/main/default/lwc/badSum/badSum.js',
    '/* BigInt in a comment is fine */\nexport const total = BigInt(1) + 2n;'
); // HR-23
w(
    'force-app/main/default/lwc/badSlot/badSlot.html',
    '<template><table><tbody><slot></slot></tbody></table></template>'
); // HR-22
w(
    'force-app/main/default/lwc/badCss/badCss.css',
    '/* .slds-button in a comment is fine */\n.slds-button { color: red; }\n.rh-x { --slds-c-button-color: red; }'
); // HR-15
w(
    'force-app/main/default/lwc/badKey/badKey.html',
    '<template><template for:each={rows} for:item="r" for:index="i"><p key={i}>{r}</p></template></template>'
); // HR-19
w('dev/main/default/tabs/Dev_Tab.tab-meta.xml', '<CustomTab><description>A dev tab.</description></CustomTab>'); // dev-only
w(
    'test-data/tests/apex/DevTest.cls',
    '/**\n * DEVELOPMENT ONLY. Never packaged.\n */\n@IsTest private class DevTest {}'
); // must NOT fire

const run = spawnSync(process.execPath, [path.join(__dirname, 'run-all.js')], {
    env: { ...process.env, ROWHOUSE_ROOT: tmp },
    encoding: 'utf8'
});
const out = run.stdout + run.stderr;
const expected = [
    'HR-1',
    'HR-2',
    'HR-3',
    'HR-5',
    'HR-8',
    'HR-9',
    'HR-15',
    'HR-19',
    'HR-22',
    'HR-23',
    'HR-25',
    'HR-26',
    'HR-27',
    'system-mode',
    'dev-only',
    'scheduled-class'
];
const missing = expected.filter(r => !out.includes(`::${r} `));
// Rules that share a name with an older one are checked by the file they fire on,
// so a check that stops catching its own plant cannot hide behind another's.
const firedOn = (rule, className) =>
    new RegExp(`file=[^,]*classes[\\\\/]${className}\\.cls,line=\\d+::${rule} `).test(out);
const plants = [
    ['HR-5', 'J', 'a static query outside GridSecurity'],
    ['HR-5', 'K', 'a Database DML method outside GridSecurity'],
    ['HR-5', 'L', 'a DML statement outside GridSecurity'],
    ['HR-5', 'M', 'FeatureManagement outside GridSecurity'],
    ['HR-5', 'N', 'a class without a sharing declaration'],
    ['HR-5', 'O', 'a class without sharing'],
    ['HR-5', 'P', 'a class with inherited sharing'],
    ['system-mode', 'Q', 'WITH SYSTEM_MODE inside a string'],
    ['HR-9', 'R', 'a named-credential callout inside a string']
];
const planted = plants.filter(([rule, className]) => !firedOn(rule, className)).map(([, , what]) => what);
const lCaught = (out.match(/classes[\\/]L\.cls,line=\d+::HR-5 /g) || []).length === 2;
if (!lCaught) planted.push('both DML statements in L (one at a line start, one after an if)');
const falsePositive = ['G', 'GridSecurity', 'S'].filter(c => new RegExp(`classes[\\\\/]${c}\\.cls`).test(out));
if (out.includes('DevTest.cls')) falsePositive.push('DevTest');
const secondApiCaught = out.includes('gridApp.js') && out.includes('found configName, height');
fs.rmSync(tmp, { recursive: true, force: true });

if (run.status !== 1 || missing.length || planted.length || falsePositive.length || !secondApiCaught) {
    console.error(out);
    console.error(
        'Self-test FAILED. Missing: ' +
            (missing.join(', ') || 'none') +
            (planted.length ? '; not caught: ' + planted.join(', ') : '') +
            (falsePositive.length ? '; false positive in ' + falsePositive.join(', ') + '.' : '') +
            (secondApiCaught ? '' : '; a second @api member on gridApp was not caught.')
    );
    process.exit(1);
}
console.log(
    `Static-gate self-test passed: all ${expected.length} rules caught, each of the ${plants.length} Apex access plants by its own file, no false positive on comments, strings or GridSecurity.`
);
