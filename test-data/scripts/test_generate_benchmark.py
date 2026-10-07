#!/usr/bin/env python3
"""
Golden rows for the benchmark generator.

The same rows are asserted in test-data/tests/apex/RowhouseBenchDataTest.cls.
If this file and that one both pass, the CSV path and the Anonymous Apex path
produce identical data. Change a golden value in one, change it in the other.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("gen", os.path.join(HERE, "generate-benchmark.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

GOLDEN = {
    1: {"Text_Field__c": "Mara Brandt, 88 Pitch Lane", "Number_Field__c": 316144,
        "Decimal_Field__c": "93888.85", "Currency_Field__c": "80944.76", "Percent_Field__c": "5.43",
        "DateTime_Field__c": "2026-09-29T21:28:00.000Z", "Checkbox_Field__c": "false",
        "Email_Field__c": "pim.ghosh74@example.com", "Phone_Field__c": "+1 555 513 4362",
        "Picklist_Field__c": "Beta", "Controlling_Picklist__c": "Software",
        "Dependent_Picklist__c": "Licence", "Multi_Picklist__c": ""},
    2: {"Text_Field__c": "Foundry Terrace", "Checkbox_Field__c": "true",
        "Controlling_Picklist__c": "Services", "Dependent_Picklist__c": ""},
    20: {"Text_Field__c": " ".join(["Mara Halloran — Sable Terrace"] * 6)},
    23: {"Picklist_Field__c": "Obsolete"},
    44: {"Multi_Picklist__c": "Green;Blue;Amber"},
    1000: {"Text_Field__c": "Sable Row", "Currency_Field__c": "18508.73",
           "Date_Field__c": "2026-11-07", "Phone_Field__c": "", "Multi_Picklist__c": "Amber;Slate"},
    10000: {"Name": "BM-010000", "Text_Field__c": "Rowan Row", "Number_Field__c": 209513,
            "DateTime_Field__c": "2025-09-01T18:33:00.000Z", "Multi_Picklist__c": "Amber;Slate;Red"},
    50000: {"Name": "BM-050000", "Text_Field__c": "Cobble Yard", "Number_Field__c": 353165,
            "Currency_Field__c": "52986.89", "DateTime_Field__c": "2025-03-06T23:47:00.000Z",
            "Email_Field__c": "kira.kowalski18@example.com", "Multi_Picklist__c": "Green"},
}


def main():
    failures = []
    for i, expected in GOLDEN.items():
        row = next(gen.rows(i, i))            # generated on its own: skip-ahead
        for field, value in expected.items():
            if row[field] != value:
                failures.append(f"row {i} {field}: expected {value!r}, got {row[field]!r}")
    full = list(gen.rows(1, 5000))
    if list(gen.rows(4990, 5000)) != full[4989:5000]:
        failures.append("a slice differs from the same rows of a longer run: the sizes would not nest")
    if failures:
        print("\n".join(failures))
        sys.exit(1)
    print(f"Benchmark generator: {len(GOLDEN)} golden rows match; slices nest.")


if __name__ == "__main__":
    main()
