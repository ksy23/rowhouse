#!/usr/bin/env bash
# Rowhouse — stand up a contributor's test org from zero.
#
# Creates a scratch org from your Dev Hub, deploys Rowhouse and everything its
# tests need (the test objects, flows, grids and Apex tests, and the
# development pages that show any grid), loads the edge-case seed set, and
# creates a deliberately restricted, non-admin test user.
#
#   test-data/scripts/seed.sh                   # new scratch org, seed data
#   test-data/scripts/seed.sh --benchmark       # also the 50,000 benchmark rows
#   test-data/scripts/seed.sh --days 1          # scratch org for 1 day (default 7)
#   test-data/scripts/seed.sh --target my-org   # an org you already have
#
# Needs the Salesforce CLI, Python 3 and a default Dev Hub
# (sf org login web --set-default-dev-hub). The scratch org has no namespace,
# so any Dev Hub will do. This is for working on Rowhouse itself: people who
# use Rowhouse install the managed package instead.
#
set -euo pipefail
# The repository root: its sfdx-project.json lists force-app, test-data and dev.
cd "$(dirname "$0")/../.."

ALIAS="rowhouse-test"
DAYS=7
BENCH=false
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --benchmark) BENCH=true; shift ;;
    --days)      DAYS="$2"; shift 2 ;;
    --target)    TARGET="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "==> creating scratch org [$ALIAS] for $DAYS day(s)"
  sf org create scratch --definition-file config/project-scratch-def.json \
     --alias "$ALIAS" --duration-days "$DAYS" --no-namespace --wait 15
  TARGET="$ALIAS"
fi

echo "==> deploying Rowhouse to [$TARGET]"
sf project deploy start --source-dir force-app --target-org "$TARGET" --wait 30

echo "==> deploying the test objects, flows, grids and Apex tests"
# The whole folder, as the package build deploys it; .forceignore leaves out
# the files in it that are not metadata.
sf project deploy start --source-dir test-data --target-org "$TARGET" --wait 30

echo "==> deploying the development pages (the Rowhouse Dev tab shows any grid)"
sf project deploy start --source-dir dev --target-org "$TARGET" --wait 15

echo "==> giving the org's admin Rowhouse and the test objects"
# Deployed fields are visible to no one until a permission grants them, and the
# bulk load below runs as the admin. Freight_Full_Access is the same permission
# set the Apex suite's fullUser() holds.
for PS in Rowhouse_Grid_User Rowhouse_Grid_Admin Freight_Full_Access Rowhouse_Dev_Tabs; do
  sf org assign permset --name "$PS" --target-org "$TARGET" >/dev/null 2>&1 || \
     echo "    ($PS already assigned — continuing)"
done

echo "==> loading the edge-case seed set (56 records)"
# If the target org is namespaced, every field needs the prefix or the column
# mapping fails silently on most columns.
NS=$(sf org display --target-org "$TARGET" --json 2>/dev/null \
     | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"].get("namespace") or "")' 2>/dev/null || echo "")
CSV=test-data/data/Consignment__c.csv
SOBJ=Consignment__c
if [ -n "$NS" ]; then
  echo "    org namespace is '$NS' — prefixing CSV headers"
  SOBJ="${NS}__Consignment__c"
  CSV=$(mktemp -t seed-ns-XXXX).csv
  python3 - "$NS" test-data/data/Consignment__c.csv "$CSV" <<'PYEOF'
import csv, sys
ns, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
rows = list(csv.reader(open(src, encoding="utf-8")))
rows[0] = [c if c == "Name" else f"{ns}__{c}" for c in rows[0]]
csv.writer(open(dst, "w", newline="", encoding="utf-8")).writerows(rows)
PYEOF
fi
# The Bulk API reads PRO-1024's 18-digit Pieces as 1.0E18 and refuses it, so
# that one record fails here and is inserted from Apex just after.
sf data import bulk --sobject "$SOBJ" --file "$CSV" --line-ending CRLF --target-org "$TARGET" --wait 10 || \
   echo "    (one record refused, as expected: PRO-1024 follows from Apex)"
APEX=$(mktemp -t pro-1024-XXXX).apex
echo "insert new ${SOBJ}(Name = 'Bath Iron fasteners, bulk', ${SOBJ%Consignment__c}Pro_Number__c = 'PRO-1024', ${SOBJ%Consignment__c}Pieces__c = Decimal.valueOf('999999999999999999'));" > "$APEX"
sf apex run --file "$APEX" --target-org "$TARGET"

echo "==> creating the restricted test user"
# Deliberately NOT an admin. An admin sees every field, so every FLS test
# passes without proving anything. The CLI makes the username unique.
sf org create user --definition-file test-data/config/test-user-def.json \
   --set-alias rowhouse-limited --target-org "$TARGET" || \
   echo "    (user may already exist — continuing)"
sf org assign permset --name Freight_Limited_Access --name Rowhouse_Grid_User \
   --on-behalf-of rowhouse-limited --target-org "$TARGET"

if [[ "$BENCH" == true ]]; then
  # The benchmark rows live in their own object, Freight_Bill__c, so the 56
  # edge-case rows above never enter a timing. The four files are steps, not
  # sets: rows 1-1,000, then 1,001-5,000, 5,001-10,000 and 10,001-50,000.
  # Loaded in order they grow the object to 1k, 5k, 10k and 50k; this loads
  # all four (50,000 rows). To benchmark each size, load one step, measure,
  # then the next:
  # docs/benchmarks.md. The same rows can be inserted from Anonymous Apex with
  # FreightBillData.insertRows(first, last).
  for n in to-1k to-5k to-10k to-50k; do
    if [[ ! -f "test-data/data/benchmark-$n.csv" ]]; then
      echo "==> generating benchmark data"; python3 test-data/scripts/generate-benchmark.py; break
    fi
  done
  for n in to-1k to-5k to-10k to-50k; do
    echo "==> loading benchmark-$n"
    # import, not upsert: no field on this object is an external Id, so an
    # upsert keyed on Name would be rejected.
    sf data import bulk --sobject Freight_Bill__c \
       --file "test-data/data/benchmark-$n.csv" --line-ending CRLF --target-org "$TARGET" --wait 30
  done
fi
echo
echo "Done. Open the org with:  sf org open --target-org $TARGET"
echo "Any grid opens at /lightning/n/Rowhouse_Dev?c__grid=<Configuration Name>,"
echo "for example Consignments."
echo
echo "Three things to check before you trust a test run:"
echo "  1. Log in AS the limited user, not as yourself:"
echo "     sf org open --target-org rowhouse-limited"
echo "  2. Confirm TC-036 kept the value 'White Glove'. If the load silently"
echo "     dropped it, the picklist was created restricted and the most"
echo "     common real-org edge case is untestable."
echo "  3. TC-002 (empty string) and TC-023 (precision overflow) do NOT survive"
echo "     the CSV path — the Bulk API turns '' into null and rounds to the"
echo "     field scale. Both cases have to be built in Apex. See"
echo "     test-data/README.md."
