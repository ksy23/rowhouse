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
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), s); };
const cls = (name, body, api = '68.0') => {
    w(`force-app/main/default/classes/${name}.cls`, body);
    w(`force-app/main/default/classes/${name}.cls-meta.xml`, `<ApexClass><apiVersion>${api}</apiVersion></ApexClass>`);
};

cls('A', 'global with sharing class A {}');                                   // HR-1
cls('B', 'public class B { void f() { Schema.SObjectType t; t.getDescribe().isUpdateable(); } }'); // HR-5
cls('C', 'public class C { void f() { Database.query(q, AccessLevel.SYSTEM_MODE); } }');         // system-mode (+HR-5)
cls('D', 'public class D { void f() { List<Account> a = [SELECT Id FROM Account WITH SECURITY_ENFORCED]; } }'); // HR-8
cls('E', 'public class E {}', '66.0');                                        // HR-8 api version
cls('F', 'public class F { void f() { new HttpRequest(); } }');               // HR-9
cls('G', '// global is fine in a comment\npublic class G { String s = \'global \'; }'); // must NOT fire
cls('H', "public with sharing class H { public static void go() { System.schedule('n', '0 0 2 * * ?', new I()); } }");
cls('I', 'public with sharing class I implements Schedulable { public void execute(SchedulableContext c) { H.go(); } }'); // a scheduled class that names another
w('force-app/main/default/staticresources/lib.js', '');                       // HR-26
w('force-app/main/default/lwc/gridTable/gridTable.js-meta.xml', '<LightningComponentBundle><isExposed>true</isExposed></LightningComponentBundle>'); // HR-2 wrong component
w('force-app/main/default/lwc/gridApp/gridApp.js-meta.xml', '<LightningComponentBundle><isExposed>true</isExposed></LightningComponentBundle>');
w('force-app/main/default/lwc/gridApp/gridApp.js', 'export default class A { @api configName; @api height; }'); // HR-2 second @api member
w('force-app/main/default/objects/Grid_Configuration__mdt/fields/Page_Size__c.field-meta.xml', '<CustomField><fieldManageability>DeveloperControlled</fieldManageability></CustomField>'); // HR-3
w('force-app/main/default/objects/Grid_Configuration__mdt/fields/Mystery__c.field-meta.xml', '<CustomField><fieldManageability>SubscriberControlled</fieldManageability></CustomField>'); // HR-3 undecided
w('force-app/main/default/lwc/gridKeyboard/gridKeyboard.js', 'export default (Base) => class extends Base {};'); // HR-25
w('force-app/main/default/lwc/cellText/cellText.js', "import GridTable from 'c/gridTable';");      // HR-27
w('force-app/main/default/lwc/badSlot/badSlot.html', '<template><table><tbody><slot></slot></tbody></table></template>'); // HR-22
w('force-app/main/default/lwc/badCss/badCss.css', '/* .slds-button in a comment is fine */\n.slds-button { color: red; }\n.rh-x { --slds-c-button-color: red; }'); // HR-15
w('force-app/main/default/lwc/badKey/badKey.html', '<template><template for:each={rows} for:item="r" for:index="i"><p key={i}>{r}</p></template></template>'); // HR-19
w('dev/main/default/tabs/Dev_Tab.tab-meta.xml', '<CustomTab><description>A dev tab.</description></CustomTab>'); // dev-only
w('test-data/tests/apex/DevTest.cls', '/**\n * DEVELOPMENT ONLY. Never packaged.\n */\n@IsTest private class DevTest {}'); // must NOT fire

const run = spawnSync(process.execPath, [path.join(__dirname, 'run-all.js')], { env: { ...process.env, ROWHOUSE_ROOT: tmp }, encoding: 'utf8' });
const out = run.stdout + run.stderr;
const expected = ['HR-1', 'HR-2', 'HR-3', 'HR-5', 'HR-8', 'HR-9', 'HR-15', 'HR-19', 'HR-22', 'HR-25', 'HR-26', 'HR-27', 'system-mode', 'dev-only', 'scheduled-class'];
const missing = expected.filter(r => !out.includes(`::${r} `));
const falsePositive = out.includes('classes/G.cls') || out.includes('DevTest.cls');
const secondApiCaught = out.includes('gridApp.js') && out.includes('found configName, height');
fs.rmSync(tmp, { recursive: true, force: true });

if (run.status !== 1 || missing.length || falsePositive || !secondApiCaught) {
    console.error(out);
    console.error('Self-test FAILED. Missing: ' + (missing.join(', ') || 'none') + (falsePositive ? '; false positive on a comment/string.' : '') + (secondApiCaught ? '' : '; a second @api member on gridApp was not caught.'));
    process.exit(1);
}
console.log(`Static-gate self-test passed: all ${expected.length} planted violations caught, no false positive on comments or strings.`);
