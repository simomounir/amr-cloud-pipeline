# Dashboard

Static React + TypeScript site that loads the published Parquet dataset and queries it
in the browser with DuckDB-WASM. No server.

## Develop

Requires Node 22.

```bash
npm ci
npm run preview:fixture   # build with the small fixture dataset and serve on :4173
npm run dev               # dev server; put a dataset in public/data/ first
npm test                  # Vitest: SQL queries against the fixture with DuckDB (Node)
npm run e2e               # Playwright smoke test (builds with the fixture)
npm run lint && npm run typecheck
```

Regenerate the fixture after schema changes (from the repo root):
`.venv/bin/python dashboard/tests/fixtures/make_fixture.py`.

## Data contract

At runtime the site reads `data/` next to `index.html`:

- `samples.parquet`, `amr_genes.parquet`, `run_summary.parquet` (results schema 1.x)
- `manifest.json` (written by `amrtools build-dataset`)
- `TAG` (dataset release tag, shown in the footer)

`pages.yml` fills `data/` from the newest `dataset-*` GitHub Release when it deploys.
All SQL lives in `src/data/sql/`; user selections reach SQL only as `?` parameters.
