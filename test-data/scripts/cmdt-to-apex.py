#!/usr/bin/env python3
"""
Custom Metadata records to anonymous Apex, for orgs reached without the sf CLI.

Custom Metadata records cannot be written through REST or Tooling DML.
This prints anonymous Apex that deploys the
given .md-meta.xml files with Metadata.Operations.enqueueDeployment. A deploy
replaces each record whole, so every value in the file is sent.

    python3 test-data/scripts/cmdt-to-apex.py test-data/config/Grid_Child.*.md-meta.xml

Paste the output into anonymous Apex; it prints
the deployment job Id. Then check that the records exist with SOQL.
"""
import sys
# The input is this repository's own record files, never untrusted XML; the
# standard library's parser does not fetch external entities.
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {
    'md': 'http://soap.sforce.com/2006/04/metadata',
    'xsi': 'http://www.w3.org/2001/XMLSchema-instance',
}
XSI_TYPE = '{http://www.w3.org/2001/XMLSchema-instance}type'


def apex_string(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n') + "'"


def apex_value(el):
    kind = (el.get(XSI_TYPE) or 'xsd:string').split(':')[-1]
    text = el.text or ''
    if el.get('{http://www.w3.org/2001/XMLSchema-instance}nil') == 'true':
        return 'null'
    if kind == 'boolean':
        return 'true' if text.strip() == 'true' else 'false'
    if kind in ('double', 'int', 'decimal'):
        number = text.strip()
        return number if '.' in number else number + '.0'  # a Decimal literal, not an Integer
    return apex_string(text)


def record(path):
    # Grid_Child.Consignments_Items.md-meta.xml -> Grid_Child, Consignments_Items
    type_name, dev_name = Path(path).name[:-len('.md-meta.xml')].split('.', 1)
    root = ET.parse(path).getroot()
    label = root.find('md:label', NS).text
    pairs = []
    for v in root.findall('md:values', NS):
        pairs.append(apex_string(v.find('md:field', NS).text))
        pairs.append(apex_value(v.find('md:value', NS)))
    return (f"a(c,{apex_string(type_name + '.' + dev_name)},{apex_string(label)},"
            f"new List<Object>{{{','.join(pairs)}}});")


# Compact on purpose: anonymous Apex travels in a URL (Tooling executeAnonymous).
HELPER = ('void a(Metadata.DeployContainer c,String n,String l,List<Object> kv){'
          'Metadata.CustomMetadata m=new Metadata.CustomMetadata();m.fullName=n;m.label=l;'
          'for(Integer i=0;i<kv.size();i+=2){Metadata.CustomMetadataValue v=new Metadata.CustomMetadataValue();'
          'v.field=(String)kv[i];v.value=kv[i+1];m.values.add(v);}c.addMetadata(m);}')


def main(paths):
    if not paths:
        sys.exit(__doc__)
    out = [HELPER, 'Metadata.DeployContainer c=new Metadata.DeployContainer();']
    out += [record(p) for p in paths]
    out.append("System.debug('Deployment job: '+Metadata.Operations.enqueueDeployment(c,null));")
    print('\n'.join(out))


if __name__ == '__main__':
    main(sys.argv[1:])
