#!/usr/bin/env python3
"""
Rowhouse — benchmark data generator.

Produces the rows behind the published benchmark, for the Rowhouse_Bench__c
test object. Three rules govern the design:

  1. Deterministic. A fixed seed means the numbers you publish can be
     reproduced by anyone who clones the repo. A benchmark nobody can
     reproduce is marketing, not evidence.

  2. The same rows from two places. This script writes CSV for the Bulk API.
     test-data/bench/classes/RowhouseBenchData.cls inserts the same rows from
     Anonymous Apex, for an org reached without the Salesforce CLI. Both draw
     from one stream, defined below, so row N is identical either way; a test
     in each language checks the same golden rows.

     The stream is Park and Miller's "minimal standard" generator (a Lehmer
     generator, multiplier 48271, modulus 2^31 - 1). It is tiny, exact in
     64-bit integers in both languages, and it can skip ahead, so any slice of
     rows can be generated on its own. Every row takes exactly DRAWS_PER_ROW
     draws, so row N always starts at the same point in the stream. That is
     what makes the sizes nest: rows 1 to 1,000 of the 50k set ARE the 1k set.

  3. Realistic distribution, not uniform. Real orgs have skewed text lengths,
     sparse optional fields and repeated picklist values. Uniform data makes a
     grid look faster than it is, because column widths stabilise immediately
     and the renderer never re-measures.

     Shape: text 70% short / 25% medium / 5% long; four columns are left blank
     some of the time (Multi_Picklist 75%, Phone 60%, Email 45%,
     Dependent_Picklist 33%), about 15% blank cells across the 14 non-Name
     columns; picklist values weighted 50/30/15/5, the last one ("Obsolete")
     no longer in the value set, as happens in any org a year old.

The files grow the object in steps. Load them in order and measure after each:

    benchmark-to-1k.csv    rows      1 - 1,000
    benchmark-to-5k.csv    rows  1,001 - 5,000
    benchmark-to-10k.csv   rows  5,001 - 10,000
    benchmark-to-50k.csv   rows 10,001 - 50,000

The last step goes past the grid's 10,000-row ceiling on purpose: at 50,000
rows the grid loads the first 10,000 and sorts and searches on the server, and that mode needs measuring too.

Usage:
    python3 generate-benchmark.py              # the four step files
    python3 generate-benchmark.py 2001 2500    # one custom slice, rows 2001-2500
"""
import csv
import os
import sys
from datetime import date, timedelta

SEED = 20260918            # fixed on purpose: see rule 1
MOD = 2147483647           # 2^31 - 1
MULT = 48271
DRAWS_PER_ROW = 24         # every row takes exactly this many draws (rule 2)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
STEPS = [(1, 1000, "to-1k"), (1001, 5000, "to-5k"), (5001, 10000, "to-10k"), (10001, 50000, "to-50k")]

COLS = ["Name", "Text_Field__c", "Number_Field__c", "Decimal_Field__c",
        "Currency_Field__c", "Percent_Field__c", "Date_Field__c",
        "DateTime_Field__c", "Checkbox_Field__c", "Email_Field__c",
        "Phone_Field__c", "Picklist_Field__c", "Controlling_Picklist__c",
        "Dependent_Picklist__c", "Multi_Picklist__c"]

FIRST = ["Ada", "Bea", "Cyrus", "Dara", "Emil", "Fiona", "Gus", "Hana", "Ivo", "Jun",
         "Kira", "Luc", "Mara", "Nils", "Oona", "Pim", "Quinn", "Rhea", "Sol", "Tam"]
LAST = ["Ashworth", "Brandt", "Calloway", "Duarte", "Ellery", "Fairbanks", "Ghosh",
        "Halloran", "Ishikawa", "Jarrett", "Kowalski", "Lindqvist", "Mbeki",
        "Novak", "Okonkwo", "Pereira", "Quintana", "Rasmussen", "Sandoval", "Trevino"]
STREET = ["Maple", "Bellwether", "Kiln", "Foundry", "Cobble", "Lantern", "Rowan",
          "Pitch", "Garrick", "Sable"]
SUFFIX = ["Row", "Terrace", "Close", "Yard", "Mews", "Lane"]
CONTROLLING = ["Hardware", "Software", "Services"]
DEPENDENT = {"Hardware": ["Keyboard", "Monitor"],
             "Software": ["Licence", "Subscription"],
             "Services": []}
MULTI = ["Red", "Green", "Blue", "Amber", "Slate"]
EPOCH = date(2024, 1, 1)


def draws(first_row, last_row):
    """Yield each row's draws, starting exactly where row `first_row` starts."""
    state = SEED % MOD or 1
    state = state * pow(MULT, DRAWS_PER_ROW * (first_row - 1), MOD) % MOD
    for _ in range(first_row, last_row + 1):
        row = []
        for _ in range(DRAWS_PER_ROW):
            state = state * MULT % MOD
            row.append(state)
        yield row


def pick(values, x):
    return values[x % len(values)]


def cents(x, top):
    """0.00 to top/100, as a string with two decimals. No floats anywhere."""
    v = x % (top + 1)
    return f"{v // 100}.{v % 100:02d}"


def picklist_value(x):
    r = x % 100
    return "Alpha" if r < 50 else "Beta" if r < 80 else "Gamma" if r < 95 else "Obsolete"


def multi_value(x):
    count = 1 + x % 3
    start = (x // 3) % len(MULTI)
    return ";".join(MULTI[(start + k) % len(MULTI)] for k in range(count))


def make_row(i, d):
    """Row i from its 24 draws. RowhouseBenchData.cls mirrors this line by line."""
    street_name, suffix_name = pick(STREET, d[1]), pick(SUFFIX, d[2])
    first_name, last_name = pick(FIRST, d[3]), pick(LAST, d[4])
    house = 1 + d[5] % 299
    roll = d[0] % 100
    if roll < 70:
        text = f"{street_name} {suffix_name}"
    elif roll < 95:
        text = f"{first_name} {last_name}, {house} {street_name} {suffix_name}"
    else:
        text = " ".join([f"{first_name} {last_name} \u2014 {street_name} {suffix_name}"] * 6)

    day = EPOCH + timedelta(days=d[10] % 1096)
    minute = d[11] % 1440
    ctrl = pick(CONTROLLING, d[20])
    deps = DEPENDENT[ctrl]

    email = ""
    if d[13] % 100 < 55:
        email = (f"{pick(FIRST, d[14])}.{pick(LAST, d[14] // 20)}"
                 f"{1 + (d[14] // 400) % 99}@example.com").lower()
    phone = ""
    if d[15] % 100 < 40:
        phone = f"+1 555 {100 + d[16] % 900} {1000 + (d[16] // 900) % 9000}"

    return {
        "Name": f"BM-{i:06d}",
        "Text_Field__c": text,
        "Number_Field__c": d[6] % 1000000,
        "Decimal_Field__c": cents(d[7], 9999999),       # 0.00 - 99,999.99
        "Currency_Field__c": cents(d[8], 25000000),     # 0.00 - 250,000.00
        "Percent_Field__c": cents(d[9], 10000),         # 0.00 - 100.00
        "Date_Field__c": day.isoformat(),
        "DateTime_Field__c": f"{day.isoformat()}T{minute // 60:02d}:{minute % 60:02d}:00.000Z",
        "Checkbox_Field__c": "true" if d[12] % 100 < 35 else "false",
        "Email_Field__c": email,
        "Phone_Field__c": phone,
        "Picklist_Field__c": picklist_value(d[19]),
        "Controlling_Picklist__c": ctrl,
        "Dependent_Picklist__c": pick(deps, d[21]) if deps else "",
        "Multi_Picklist__c": multi_value(d[18]) if d[17] % 100 < 25 else "",
    }


def rows(first_row, last_row):
    for i, d in zip(range(first_row, last_row + 1), draws(first_row, last_row)):
        yield make_row(i, d)


def write(first_row, last_row, label):
    path = os.path.join(OUT_DIR, f"benchmark-{label}.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        for row in rows(first_row, last_row):
            w.writerow(row)
    size = os.path.getsize(path)
    print(f"  benchmark-{label}.csv  rows {first_row:>6,} - {last_row:>6,}  {size / 1024:>8.1f} KB")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"seed={SEED} (fixed: reproducible)")
    if len(sys.argv) == 3:
        a, b = int(sys.argv[1]), int(sys.argv[2])
        write(a, b, f"rows-{a}-{b}")
    else:
        for a, b, label in STEPS:
            write(a, b, label)


if __name__ == "__main__":
    main()
