#!/usr/bin/env python3
"""
Golden rows for the benchmark generator.

The same rows are asserted in test-data/tests/apex/FreightBillDataTest.cls.
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
    1: {"Consignee__c": "Mara Brandt, 88 Pitch Lane", "Pieces__c": 316144,
        "Weight__c": "93888.85", "Freight_Charge__c": "80944.76", "Fuel_Surcharge__c": "5.43",
        "Picked_Up__c": "2026-09-29T21:28:00.000Z", "Delivered__c": "false",
        "Contact_Email__c": "pim.ghosh74@granitecoastfreight.com", "Contact_Phone__c": "+1 555 513 4362",
        "Service_Level__c": "Standard", "Mode__c": "LTL",
        "Equipment__c": "Pallet", "Handling__c": ""},
    2: {"Consignee__c": "Foundry Terrace", "Delivered__c": "true",
        "Mode__c": "Parcel", "Equipment__c": ""},
    20: {"Consignee__c": " ".join(["Mara Halloran — Sable Terrace"] * 6)},
    23: {"Service_Level__c": "White Glove"},
    44: {"Handling__c": "Liftgate;Inside Delivery;Appointment"},
    1000: {"Consignee__c": "Sable Row", "Freight_Charge__c": "18508.73",
           "Ship_Date__c": "2026-11-07", "Contact_Phone__c": "", "Handling__c": "Appointment;Hazmat"},
    10000: {"Name": "FB-010000", "Consignee__c": "Rowan Row", "Pieces__c": 209513,
            "Picked_Up__c": "2025-09-01T18:33:00.000Z", "Handling__c": "Appointment;Hazmat;Fragile"},
    50000: {"Name": "FB-050000", "Consignee__c": "Cobble Yard", "Pieces__c": 353165,
            "Freight_Charge__c": "52986.89", "Picked_Up__c": "2025-03-06T23:47:00.000Z",
            "Contact_Email__c": "kira.kowalski18@granitecoastfreight.com", "Handling__c": "Liftgate"},
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
