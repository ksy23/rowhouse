#!/usr/bin/env python3
"""
Generate the Jest fixture from the seed CSV.

The fixture and the org data must be the same records. Hand-maintaining two
copies guarantees they drift, and a Jest suite that passes against stale
fixtures while the org data has moved on is worse than no suite.
Run this whenever generate-seed.py changes.
"""
import csv, json, os

HERE = os.path.dirname(__file__)
SRC  = os.path.join(HERE, "..", "data", "Consignment__c.csv")
OUT  = os.path.join(HERE, "..", "tests", "jest", "fixtures", "seed.js")

NUM  = {"Pieces__c", "Weight__c", "Freight_Charge__c", "Fuel_Surcharge__c"}
BOOL = {"Delivered__c"}

rows = []
with open(SRC, encoding="utf-8") as f:
    for i, r in enumerate(csv.DictReader(f), start=1):
        rec = {"Id": f"a00000000000{i:03d}AAA"}          # deterministic record Ids
        for k, v in r.items():
            if v == "":
                rec[k] = None
            elif k in NUM:
                rec[k] = float(v) if "." in v else int(v)
            elif k in BOOL:
                rec[k] = v == "true"
            else:
                rec[k] = v
        rows.append(rec)

COLUMNS = [
    {"field": "Name",              "label": "Name",      "type": "text",     "editable": True,  "sortable": True},
    {"field": "Pro_Number__c",      "label": "PRO Number", "type": "text",     "editable": False, "sortable": True},
    {"field": "Consignee__c",     "label": "Consignee", "type": "text",     "editable": True,  "sortable": True},
    {"field": "Pieces__c",   "label": "Pieces",    "type": "number",   "editable": True,  "sortable": True},
    {"field": "Freight_Charge__c", "label": "Freight Charge", "type": "currency", "editable": True,  "sortable": True},
    {"field": "Ship_Date__c",     "label": "Ship Date", "type": "date",     "editable": True,  "sortable": True},
    {"field": "Delivered__c", "label": "Delivered", "type": "checkbox", "editable": True,  "sortable": True},
    {"field": "Service_Level__c", "label": "Service Level", "type": "picklist", "editable": True,  "sortable": True},
]

banner = ("// GENERATED FILE — do not edit.\n"
          "// Source: data/Consignment__c.csv\n"
          "// Regenerate: python3 scripts/build-jest-fixture.py\n"
          "// Keeping this generated is what stops the Jest fixtures and the org\n"
          "// data from drifting apart.\n\n")

with open(OUT, "w", encoding="utf-8") as f:
    f.write(banner)
    f.write("export const columns = " + json.dumps(COLUMNS, indent=4) + ";\n\n")
    f.write("export const seedRows = " + json.dumps(rows, indent=4, ensure_ascii=False) + ";\n")

print(f"wrote {len(rows)} fixture rows and {len(COLUMNS)} columns -> {os.path.relpath(OUT)}")
