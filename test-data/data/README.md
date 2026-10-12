# data/

`Consignment__c.csv` — the 56 edge-case records. Committed, because
each row is a deliberate choice rather than generated filler.

`benchmark-to-{1,5,10,50}k.csv` — **not here until you generate them:**

```bash
python3 ../scripts/generate-benchmark.py
```

Each file is the next step up: rows 1–1,000, then 1,001–5,000, 5,001–10,000
and 10,001–50,000, loaded in order. Deterministic, so the files you get are
byte-for-byte the ones behind any published number. About 8 MB in all, which
is why they are generated rather than committed.

Neither file should be hand-edited. Both come from `scripts/`, and the Jest
fixture is generated from the seed CSV — edit a CSV directly and the next
regeneration silently discards your change.
