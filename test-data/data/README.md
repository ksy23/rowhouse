# data/

`Rowhouse_Test_Record__c.csv` — the 56 edge-case records. Committed, because
each row is a deliberate choice rather than generated filler.

`benchmark-{1,5,10}k.csv` — **not here until you generate them:**

```bash
python3 ../scripts/generate-benchmark.py
```

Deterministic, so the files you get are byte-for-byte the ones behind any
published number. 2.4 MB total, which is why they are generated rather than
committed.

Neither file should be hand-edited. Both come from `scripts/`, and the Jest
fixture is generated from the seed CSV — edit a CSV directly and the next
regeneration silently discards your change.
