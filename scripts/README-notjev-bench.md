# notjev accuracy bench

Measures how right the three classification decisions (format, theme, importance) are on your own articles. Code: `server/bench/notjev/`. Spec: `docs/spec/87_feature_classification.md`.

The production database is never written: the bench copies it with `VACUUM INTO` into `data/notjev-bench-<ISO>/snapshot.db` and reads only that copy. Model, server URL, API key, thresholds and themes are read from the copy, as production reads them.

## Run it

From the app: Settings → Integration → Article classification → Accuracy bench → **Trial run** (20 articles) or **Full run** (300). The panel shows progress, can stop or resume a run, and opens the report.

From a terminal, with the settings of `scripts/notjev-bench.config.json`:

```bash
npm run bench:notjev
```

The shipped config has `"trial": true` for a first pass; set it to `false` for the full sample. Other keys: `sampleSize`, `trialSize`, `seed`, `concurrency` (1 by default: the inference server is shared), `sourceDb` and `outputDir` (empty = the server's own database and data folder), `replayFile`, `thetas`, `reasoning` (max tokens, timeout, temperature and instruction of the reasoned reference).

Cost: 9 calls per article (3 one-token readouts, 3 with options permuted, 3 reasoned). The reasoned calls dominate: count hours for 300 articles.

## Resume a run

Every answer is appended to `results.jsonl` as it arrives. To finish an interrupted run, press **Resume** in the panel, or set `"runDir"` to its folder (e.g. `"data/notjev-bench-2026-11-03T10-20-30-000Z"`) and run the command again: recorded calls are skipped.

## Re-inject your arbitrations

1. Open `report.html`, go to the disagreement list and mark each one: *notjev is right*, *reference is right* or *neither*. Choices stay in your browser.
2. Click **Export arbitrations (JSON)**.
3. Either press **Import arbitrations** next to the run in the panel and pick the file, or set in the config:

   ```json
   "runDir": "data/notjev-bench-<ISO>",
   "arbitrationsFile": "path/to/arbitrations-notjev-bench-<ISO>.json"
   ```

   and run `npm run bench:notjev`. With `arbitrationsFile` set, no call is made: the report is recomputed from the recorded answers and shows accuracy after arbitration. Empty `arbitrationsFile` again afterwards.

## Files of a run

| File | Content |
|---|---|
| `snapshot.db` | Consistent copy of the database |
| `sample.json` | Articles, labels, settings read |
| `results.jsonl` | One line per call: request, full response, probabilities, p1, margin, band, coverage, degraded, time |
| `report.html` | The report, self-contained |
| `replay.json` | Recording for `npx notjev replay replay.json --truth gold` (gold = reasoned reference) |
| `arbitrations.json` | Last imported arbitrations |
| `progress.json`, `bench.log` | Progress and log of a run started from the app |
