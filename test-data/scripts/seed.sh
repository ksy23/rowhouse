#!/usr/bin/env bash
# Rowhouse — load the test org from zero.
#
# Creates a scratch org, deploys the test-only objects, loads the edge-case
# seed set, and assigns the deliberately-restricted permission set to a
# non-admin test user.
#
#   ./seed.sh                      # scratch org, seed data only
#   ./seed.sh --benchmark          # also load the 50,000 benchmark rows
#   ./seed.sh --target my-org      # use an existing org instead of a new one
#
set -euo pipefail
cd "$(dirname "$0")/.."

ALIAS="rowhouse-test"
BENCH=false
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --benchmark) BENCH=true; shift ;;
    --target)    TARGET="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "==> creating scratch org [$ALIAS]"
  sf org create scratch --definition-file config/project-scratch-def.json \
     --alias "$ALIAS" --duration-days 7 --set-default --wait 10
  TARGET="$ALIAS"
fi

echo "==> deploying test-only metadata to [$TARGET]"
sf project deploy start --source-dir metadata --target-org "$TARGET" --wait 10

echo "==> giving the org's admin field access to the test objects"
# Deployed fields are visible to no one until a permission grants them, and the
# bulk load below runs as the admin. Rowhouse_Test_Full is the same permission
# set the Apex suite's fullUser() holds.
sf org assign permset --name Rowhouse_Test_Full --target-org "$TARGET" || \
   echo "    (already assigned — continuing)"

echo "==> loading edge-case seed set (56 records)"
# If the target org is namespaced, every field needs the prefix or the column
# mapping fails silently on most columns.
NS=$(sf org display --target-org "$TARGET" --json 2>/dev/null \
     | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"].get("namespace") or "")' 2>/dev/null || echo "")
CSV=data/Rowhouse_Test_Record__c.csv
SOBJ=Rowhouse_Test_Record__c
if [ -n "$NS" ]; then
  echo "    org namespace is '$NS' — prefixing CSV headers"
  SOBJ="${NS}__Rowhouse_Test_Record__c"
  CSV=$(mktemp -t seed-ns-XXXX).csv
  python3 - "$NS" data/Rowhouse_Test_Record__c.csv "$CSV" <<'PYEOF'
import csv, sys
ns, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
rows = list(csv.reader(open(src, encoding="utf-8")))
rows[0] = [c if c == "Name" else f"{ns}__{c}" for c in rows[0]]
csv.writer(open(dst, "w", newline="", encoding="utf-8")).writerows(rows)
PYEOF
fi
sf data import bulk --sobject "$SOBJ" --file "$CSV" --target-org "$TARGET" --wait 10

echo "==> loading grid configuration"
sf project deploy start --source-dir config --target-org "$TARGET" --wait 10

echo "==> creating the restricted test user"
# Deliberately NOT an admin. An admin sees every field, so every FLS test
# passes without proving anything.
sf org create user --definition-file config/test-user-def.json \
   --set-alias rowhouse-limited --target-org "$TARGET" || \
   echo "    (user may already exist — continuing)"
sf org assign permset --name Rowhouse_Test_Limited \
   --on-behalf-of rowhouse-limited --target-org "$TARGET"

if [[ "$BENCH" == true ]]; then
  # The benchmark rows live in their own object, Rowhouse_Bench__c, so the 56
  # edge-case rows above never enter a timing. The four files are steps, not
  # sets: rows 1-1,000, then 1,001-5,000, 5,001-10,000 and 10,001-50,000.
  # Loaded in order they grow the object to 1k, 5k, 10k and 50k; this loads
  # all four (50,000 rows). To benchmark each size, load one step, measure,
  # then the next:
  # docs/benchmarks.md. The same rows can be inserted from Anonymous Apex with
  # RowhouseBenchData.insertRows(first, last).
  for n in to-1k to-5k to-10k to-50k; do
    if [[ ! -f "data/benchmark-$n.csv" ]]; then
      echo "==> generating benchmark data"; python3 scripts/generate-benchmark.py; break
    fi
  done
  sf project deploy start --source-dir bench --target-org "$TARGET" --wait 10
  for n in to-1k to-5k to-10k to-50k; do
    echo "==> loading benchmark-$n"
    # import, not upsert: no field on this object is an external Id, so an
    # upsert keyed on Name would be rejected.
    sf data import bulk --sobject Rowhouse_Bench__c \
       --file "data/benchmark-$n.csv" --target-org "$TARGET" --wait 30
  done
fi
echo
echo "Done. Two things to check before you trust a test run:"
echo "  1. Log in AS the limited user, not as yourself. sf org open --target-org $TARGET"
echo "  2. Confirm TC-036 kept the value 'Obsolete'. If the load silently"
echo "     dropped it, the picklist was created restricted and the most"
echo "     common real-org edge case is untestable."
echo "  3. TC-002 (empty string) and TC-023 (precision overflow) do NOT survive"
echo "     the CSV path — the Bulk API turns '' into null and rounds to the"
echo "     field scale. Both cases have to be built in Apex. See README."
