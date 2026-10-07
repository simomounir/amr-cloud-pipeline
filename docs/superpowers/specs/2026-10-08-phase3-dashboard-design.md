# Phase 3: Static AMR Dashboard — Design

Date: 2026-10-08
Status: Draft for review
Builds on: Phase 2 spec (`2026-10-07-phase2-results-schema-design.md`), results schema v1
Source brief: `docs/amr-cloud-pipeline-project.md` (sections 4 and 6, dashboard level 1)

## 1. Scope

A static dashboard on GitHub Pages that loads the published Parquet dataset and
queries it in the visitor's browser with DuckDB-WASM. No server, no database, $0.
It is built before the Phase 4 cloud run, so it must work unchanged when the dataset
grows from tens to thousands of isolates.

**In scope:**
- A seed dataset of about 30 real isolates, processed on GitHub Actions ($0).
- Versioned dataset publishing as GitHub Releases.
- The dashboard (React + TypeScript), its tests and its deploy workflow.
- Schema v1.1.0: new `animal` isolation source category (deferred from Phase 2).

**Out of scope:** map view, free-form SQL for visitors (brief level 2), per-isolate
pages, AWS (Phase 4).

## 2. Decisions

| Topic | Decision | Reason |
|---|---|---|
| Stack | React + TypeScript + Vite | User choice: frontend signal with standard tooling |
| Query engine | DuckDB-WASM, loaded from jsDelivr | In-browser SQL over Parquet; cached CDN bundle |
| Charts | Observable Plot via a small React wrapper | Concise stacked bars and heatmaps |
| Development data | ~30 real isolates run on GitHub Actions | Real and large enough to design with; $0 |
| Dataset delivery | GitHub Releases `dataset-YYYY-MM-DD`; Pages build downloads the latest | Versioned, out of git history, swap-in for Phase 4 |
| Publishing | Manual (`scripts/publish-dataset.sh`), user approves each release | Publishing is outward-facing |
| Node | 22 LTS (local machine has 18; install via nvm or Homebrew) | Current Vite requires Node ≥ 20.19 |

## 3. Schema v1.1.0 (`animal` source category)

- `SOURCE_CATEGORIES` gains `animal`; `SCHEMA_VERSION = "1.1.0"` (additive, minor bump).
- `categorize_source(raw, host=None)`: if `host` is present, not a missing token and
  not `Homo sapiens` (case-insensitive), the category is `animal` unless the text
  matches the `environmental` rule. Otherwise the existing rules apply.
- `export` passes the samplesheet `host` to `categorize_source`.
- `schemas/v1.1.0/*.json` generated; `schemas/v1.0.0/` kept for reference.
- amrtools and pipeline version 0.3.0 (new image tag).
- The dashboard accepts any `1.x` dataset and treats unknown categories as `other`
  in the source filter, so later minor versions do not break it.

## 4. Seed dataset

- `data/seed_accessions.txt`: about 30 Illumina paired-end *K. pneumoniae* run
  accessions with a collection year and country, covering at least 8 countries,
  at least 5 collection years, and at least 5 carbapenemase-carrying isolates
  according to their study descriptions. `data/README.md` records the ENA query used,
  the selection rules and the date.
- `.github/workflows/seed-dataset.yml` (manual trigger only):
  1. `amrtools fetch-samples --accession-file data/seed_accessions.txt`.
  2. `nextflow run . -profile docker --input samples.csv --outdir results/seed`
     with the cached AMRFinderPlus database. Shovill's default depth cap (150x) bounds
     runtime; job timeout 330 minutes.
  3. `amrtools build-dataset results/seed/parquet --out dataset`.
  4. Upload `dataset/`, `samples.csv`, `samples.skipped.csv` and the Nextflow
     execution report as the `seed-dataset` artifact.
- `scripts/publish-dataset.sh <artifact-run-id>`: downloads the artifact, runs
  `amrtools validate dataset`, and creates Release `dataset-YYYY-MM-DD` with the
  three Parquet files and `manifest.json`. It refuses if validation fails or the tag
  exists. The user runs it or approves it.

## 5. Dashboard

### 5.1 Layout

One page: header, filter bar, four panels, footer. Single column below 900 px.

**Filters** (each option shows its isolate count under the other active filters):
country, collection year range, source category, sequence type, "carbapenemase
carriers only", "hide QC warnings" (on by default). A "Clear filters" button.

**Panels:**
1. **Headline numbers:** isolates shown; % with a carbapenemase; % with CTX-M (ESBL);
   countries; year range. Each states coverage where relevant
   ("year known for 59%").
2. **Resistance over time:** stacked bars per collection year of isolates by
   carbapenemase family (KPC, NDM, OXA-48-like, VIM, IMP, other, none). Undated
   isolates are a separate "undated" bar.
3. **Gene × drug class heatmap:** the 20 most frequent AMR elements
   (`element_type = 'AMR'`) by drug class; cell value is % of shown isolates carrying
   the element.
4. **Isolate table:** sample, country, year, source, ST, carbapenemase genes,
   CTX-M genes, QC status; sortable; sample links to
   `https://www.ebi.ac.uk/ena/browser/view/<run_accession>` when present; paginated
   at 50 rows; "Download CSV" exports all filtered rows.

**Footer:** dataset tag, `manifest.created_at`, isolate count, schema version, a link
to the repo, and "Public data; demonstrates a method, not surveillance findings."

### 5.2 Shared definitions (SQL views created at load)

- `carbapenemases(sample, gene_symbol, family)`: rows of `amr_genes` with
  `element_subtype = 'AMR'` and `drug_subclass = 'CARBAPENEM'`. Family from the gene
  symbol: `blaKPC*` KPC, `blaNDM*` NDM, `blaVIM*` VIM, `blaIMP*` IMP, `blaOXA*` with
  carbapenem subclass OXA-48-like, otherwise `other`.
- `esbl(sample, gene_symbol)`: `amr_genes` rows with `gene_symbol` starting `blaCTX-M`.
- `isolates`: `samples` joined to `run_summary`, plus `has_carbapenemase`,
  `carbapenemase_genes`, `ctxm_genes` (comma-joined, sorted).
- An isolate with several carbapenemase families counts once per family in the
  timeline, and once in the headline percentage.

### 5.3 Code structure

```
dashboard/
  index.html, vite.config.ts, tsconfig.json, package.json, eslint.config.js
  src/
    main.tsx, App.tsx
    data/
      db.ts          # init DuckDB-WASM, register Parquet over HTTP, create views, check schema
      sql/*.sql      # views.sql, headline.sql, timeline.sql, heatmap.sql, isolates.sql, options.sql
      queries.ts     # typed functions: one per panel, take Filters, return rows
      filters.ts     # Filters type; toWhere(filters) -> { sql, params } (prepared-statement params)
      csv.ts         # rows -> CSV text (RFC 4180 quoting)
    components/      # FilterBar, Headline, Timeline, Heatmap, IsolateTable, Footer, PlotFigure, States
  public/data/       # filled at build time; git-ignored
  tests/
    fixtures/        # small Parquet dataset written by amrtools (real schema), known answers
    queries.test.ts, filters.test.ts, csv.test.ts, scale.test.ts
    e2e/smoke.spec.ts
```

`queries.ts` and `filters.ts` run unchanged in Node (tests, `@duckdb/node-api`) and in
the browser (DuckDB-WASM) behind a small `Connection` interface with `query(sql, params)`.

## 6. Error handling

- Loading skeleton while DuckDB-WASM and data load.
- `manifest.json` or a Parquet file fails to load: "Dataset unavailable" message with
  the failing URL; no blank charts.
- Dataset schema major version ≠ 1: "Dataset schema X not supported by this dashboard".
- No WebAssembly: "This dashboard needs a current browser".
- A panel query fails: that panel shows an error card; others keep working.
- Empty filter result: "No isolates match these filters" and "Clear filters".

## 7. Performance and accessibility

- All panel queries re-run on filter change, debounced 150 ms.
- `scale.test.ts` builds a 10,000-isolate synthetic dataset in a temp folder (never
  committed or published) and requires every panel query to finish within 1 s in Node.
- Colour-blind-safe palette (Okabe-Ito for families); filters reachable by keyboard;
  semantic `<table>`; charts have text titles and an accessible summary line.

## 8. Testing and CI

- **Vitest:** each query against the fixture dataset with hand-computed answers
  (e.g. a 2019 German KPC isolate appears in the 2019 KPC bar, the KPC heatmap row,
  and the Germany filter count; undated isolates count as undated; QC toggle removes
  `warn` isolates); `toWhere` with quotes and unusual values produces parameters, not
  SQL text; CSV quoting; schema-version check; scale test.
- **Playwright** (Chromium): build with the fixture data, open the page, check all
  four panels render, apply the country filter and check the headline count changes,
  download the CSV and check its header.
- **amrtools (pytest):** `animal` rule tests; schema 1.1.0 JSON matches.
- **CI** (`ci.yml`): new `dashboard` job on push to main and PRs: `npm ci`, ESLint,
  `tsc --noEmit`, Vitest, Playwright.
- **`pages.yml`:** on push to main touching `dashboard/**`, on `release: published`
  with a `dataset-` tag, and manually; downloads the latest `dataset-*` Release into
  `dashboard/public/data/`, builds, deploys with `actions/deploy-pages`. Requires
  enabling Pages (source: GitHub Actions) in the repo settings once.

## 9. Done criteria

- Seed dataset (~30 isolates) published as a `dataset-*` Release.
- Dashboard live on GitHub Pages showing it; README links to it.
- All CI jobs green on main, including `dashboard`.
- amrtools 0.3.0 image published (schema 1.1.0).
