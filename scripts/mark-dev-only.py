#!/usr/bin/env python3
"""
Mark every component that is never packaged as DEVELOPMENT ONLY.

Everything under test-data/ and dev/ stays out of the package.
Each such component says "DEVELOPMENT ONLY." at
the start of its description, so nobody mistakes it for part of Rowhouse in
an org's Setup. Apex classes have no description, so their header comment
starts with it instead. Custom Metadata records have no description at all.

Run from the repo root: python3 scripts/mark-dev-only.py
It changes only files that need it and prints them. The static check
scripts/checks/dev-only.js fails when one is missing.
"""
import os
import re
import sys

ROOTS = ['test-data', 'dev']
PREFIX = 'DEVELOPMENT ONLY.'
# Components whose metadata has a description element.
DESCRIBED = ('.object-meta.xml', '.field-meta.xml', '.permissionset-meta.xml',
             '.flow-meta.xml', '.tab-meta.xml', '.flexipage-meta.xml', '.js-meta.xml')
LIMITS = {'.permissionset-meta.xml': 255, '.flexipage-meta.xml': 255}
OLD_MARKS = re.compile(r'^(development only[.:]?|test data only[.:]?|development-only[.:]?)\s*', re.I)


def esc(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def unesc(text):
    for code, char in (('&lt;', '<'), ('&gt;', '>'), ('&apos;', "'"), ('&quot;', '"'), ('&amp;', '&')):
        text = text.replace(code, char)
    return text


def tag(xml, name):
    m = re.search(r'<%s>([^<]*)</%s>' % (name, name), xml)
    return unesc(m.group(1)).strip() if m else ''


def new_text(path, xml):
    """A description for a component that has none."""
    folder = path.split(os.sep)
    if path.endswith('.field-meta.xml'):
        obj = folder[folder.index('fields') - 1]
        owner = {
            'Rowhouse_Test_Record__c': 'the Rowhouse test records, used by the Apex tests and the test grids',
            'Rowhouse_Test_Child__c': 'the Rowhouse test child records, used by the child table and rollup tests',
            'Rowhouse_Bench__c': 'the Rowhouse benchmark rows (docs/benchmarks.md)',
        }.get(obj, obj)
        return 'A field of %s.' % owner
    if path.endswith('.tab-meta.xml') or path.endswith('.flexipage-meta.xml'):
        label = tag(xml, 'label') or tag(xml, 'masterLabel')
        where = 'for developing Rowhouse'
        kind = 'tab' if path.endswith('.tab-meta.xml') else 'Lightning page'
        return 'The %s %s, %s.' % (label, kind, where)
    return 'Part of the Rowhouse test and development setup, never packaged.'


def insert_description(xml, text):
    """Put <description> among the top-level elements in alphabetical order, as Salesforce writes them."""
    lines = xml.split('\n')
    for i, line in enumerate(lines):
        m = re.match(r'^    <([A-Za-z]+)[ >/]', line)
        if m and m.group(1) not in ('fullName',) and m.group(1) > 'description':
            lines.insert(i, '    <description>%s</description>' % esc(text))
            return '\n'.join(lines)
    raise ValueError('no place for a description')


def mark_xml(path):
    xml = open(path, encoding='utf-8').read()
    m = re.search(r'<description>([\s\S]*?)</description>', xml)
    if m:
        current = unesc(m.group(1)).strip()
        if current.startswith(PREFIX + ' '):
            return False
        rest = OLD_MARKS.sub('', current)
        first = rest.split(' ')[0]
        if first.islower():  # "the App Builder…" becomes "The App Builder…"; "gridApp" stays as it is
            rest = rest[:1].upper() + rest[1:]
        text = '%s %s' % (PREFIX, rest)
        xml = xml[:m.start()] + '<description>%s</description>' % esc(text) + xml[m.end():]
    else:
        text = '%s %s' % (PREFIX, new_text(path, xml))
        xml = insert_description(xml, text)
    for ending, limit in LIMITS.items():
        if path.endswith(ending) and len(text) > limit:
            sys.exit('%s: description is %d characters, over %d' % (path, len(text), limit))
    open(path, 'w', encoding='utf-8').write(xml)
    return True


def mark_apex(path):
    src = open(path, encoding='utf-8').read()
    if not src.startswith('/**'):
        sys.exit('%s: no header comment' % path)
    first = src.split('\n')[1] if '\n' in src else ''
    if PREFIX in first:
        return False
    lines = src.split('\n')
    # A header that already says it, in other words, says it in these words now.
    lines = [re.sub(r'^( \* )TEST DATA ONLY\. Never packaged\.$', r'\1REMOVE', l) for l in lines]
    lines = [l for l in lines if l != ' * REMOVE']
    lines.insert(1, ' * %s Never packaged.' % PREFIX)
    open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    return True


def main():
    changed = []
    for root in ROOTS:
        for folder, _, files in os.walk(root):
            for name in sorted(files):
                path = os.path.join(folder, name)
                if name.endswith(DESCRIBED):
                    if mark_xml(path):
                        changed.append(path)
                elif name.endswith('.cls'):
                    if mark_apex(path):
                        changed.append(path)
    for path in changed:
        print(path)
    print('%d changed' % len(changed))


if __name__ == '__main__':
    main()
