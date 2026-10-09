# Dashboard

Static React + TypeScript site that loads published Parquet datasets and queries them in the
browser with DuckDB-WASM. No server, no database, no external map or font service at runtime.
Live: https://simomounir.github.io/amr-cloud-pipeline/

## Pages

Routes are hash-based (`#/...`), so the site works on GitHub Pages without server rewrites.

| Route | Page | Contents |
|---|---|---|
| `#/` | Home | What the project is (*K. pneumoniae* only), how it works, one card per study |
| `#/study/<name>` | Study | Hand-written background and findings, each linked to a figure (heatmap, periods, map, agreement), caveats, and a "how we know" section |
| `#/explore` | Explore | Filters and charts across all loaded studies, isolate table with CSV export |
| `#/method` | Method | How the pipeline works and how to check it |

The study text comes from `studies/<name>/story.md` (shipped as `study.json`). The site shows it
as written and never generates interpretation.

## Data loading

- `studies.json` pins one release per study, for example
  `{ "study": "carbapenemase-clones", "release": "dataset-carbapenemase-clones-2026-10-09" }`.
  `scripts/publish-dataset.sh --study <name>` updates it.
- On deploy, `.github/workflows/pages.yml` downloads each pinned release into
  `public/data/<study>/` and copies `studies.json` to `public/data/studies.json`.
  `public/data/` is git-ignored.
- Each study folder holds `samples.parquet`, `run_summary.parquet`, `amr_genes.parquet`
  (results schema 1.x), `manifest.json`, `study.json` and `cohort.parquet`.
- At runtime the page registers these files with DuckDB-WASM and builds views over them
  (`src/data/`). All SQL lives in `src/data/sql/`; user selections reach SQL only as `?` parameters.

## URL state

Page, study and filters live in the hash (`src/state/url.ts`), for example
`#/explore?clone=ST147&family=NDM`. Lists use comma-separated values. Malformed
values are ignored, so any link opens a valid page and can be shared.

## Theme

Light and dark (`src/theme.ts`). The header toggle sets it and the choice is kept in the browser;
without a stored choice it follows the system setting. Family colours are Okabe-Ito in fixed order (KPC, NDM, OXA-48-like,
VIM, IMP, other, none), with separate dark-mode steps checked against the dark surface.

## Develop

Requires Node 22.

```bash
npm ci
npm run preview:fixture   # build with the small fixture dataset (two made-up studies) and serve on :4173
npm run dev               # dev server; put a dataset in public/data/<study>/ first
npm test                  # Vitest: SQL queries against the fixture with DuckDB (Node), state, text
npm run e2e               # Playwright browser tests (builds with the fixture)
npm run lint && npm run typecheck
```

Regenerate the fixture after schema changes (from the repo root):
`.venv/bin/python dashboard/tests/fixtures/make_fixture.py`.
