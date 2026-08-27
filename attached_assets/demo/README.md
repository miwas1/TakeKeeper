# The Last Cup demo fixtures

These original synthetic stills exercise TakeKeeper's approved-state memory.
They are test inputs—not precomputed AI results.

| Order | File | Deliberate visible state |
| --- | --- | --- |
| 1 | `last-cup-reference-a.png` | Red jacket unzipped; white mug; phone and keys stable |
| 2 | `last-cup-take-b.png` | Red jacket zipped; all props otherwise stable |
| 3 | `last-cup-take-c.png` | Jacket remains zipped; mug changes from white to blue |

## Live acceptance run

1. Seed the database and open **The Last Cup → Scene 1 → Shot 1A**.
2. Upload `last-cup-reference-a.png` as Reference A and run live analysis.
3. Upload `last-cup-take-b.png` as the next take and run live analysis.
4. Review the jacket issue. Mark it **Intentional → From now on**.
5. Upload `last-cup-take-c.png` and run live analysis.
6. Confirm the approved zipped jacket is no longer flagged and the blue mug is still surfaced for review. Do not require exact issue text or confidence.
7. Circle Take C, inspect Activity and Agent Activity, generate the report, and reload to verify persistence.

If Gemini misses a visually obvious change, record the real failed run and retry; never insert a fabricated issue. Run this flow against the public Replit URL before recording the demo.

`last-cup-screenplay.txt` is an original minimal screenplay import fixture. `last-cup-fixture.json` is machine-readable fixture metadata for future browser automation. No real production media or copyrighted screenplay is included.
