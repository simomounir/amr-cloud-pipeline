# Phase 3 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static React dashboard on GitHub Pages that queries the published Parquet dataset in the browser, plus a free ~30-isolate seed dataset and schema 1.1.0.

**Architecture:** All data logic is SQL files plus a small TypeScript layer behind a `Connection` interface, so the same queries run in Vitest (DuckDB Node) and in the browser (DuckDB-WASM). React components only render query results. Datasets are GitHub Releases; the Pages workflow downloads the latest one at build time.

**Tech Stack:** Node 22, React 19, TypeScript 5.9, Vite 8, Vitest 5, Playwright 1.64, @duckdb/duckdb-wasm 1.32.0, @duckdb/node-api 1.4.5-r.1, @observablehq/plot 0.6.17, ESLint 10 + typescript-eslint 8.

**Spec:** `docs/superpowers/specs/2026-10-08-phase3-dashboard-design.md`

## Global Constraints

- Branch `phase3-dashboard`. No pushes, releases or Pages changes without the user's explicit OK. No `Co-Authored-By` trailers.
- Node 22 LTS installed under `~/.local/node22` (user-level); `PATH="$HOME/.local/node22/bin:$PATH"` for every npm command.
- Exact dependency versions (no `^`): see Task 3 `package.json`.
- All SQL lives in `dashboard/src/data/sql/*.sql`. User-selected values reach SQL only as `?` parameters.
- Every count/percentage column in SQL is cast (`::INTEGER`, `::DOUBLE`) so Node and WASM return plain JS numbers, not BigInt.
- Schema: dashboard accepts any `schema_version` with major 1.
- amrtools/pipeline version 0.3.0; image `ghcr.io/simomounir/amrtools:0.3.0`; `SCHEMA_VERSION = "1.1.0"`.
- Dataset release tags: `dataset-YYYY-MM-DD`.

## Review Focus

1. **Country names with quotes** (`Côte d'Ivoire`) in filters: must work as parameters, never break SQL. Pinned in Task 4 (`toWhere` test) and Task 5 (fixture isolate F6 filter test).
2. **Point mutations with a carbapenem subclass** (`ompK36_D135DGD`, subclass CARBAPENEM): must not count as carbapenemases. Pinned in Task 5 (fixture F4).
3. **Year filter set while undated isolates exist:** undated isolates drop out of a year-range filter but show as "undated" with no year filter. Pinned in Task 5.
4. **Filter that matches nothing:** queries return zero rows / zero counts without NaN or SQL errors (division by zero in shares). Pinned in Task 5 (`empty result` test).
5. **Dataset from a future major schema** (`2.0.0`): clear message, no charts. Pinned in Task 6 (`checkSchema` test).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/amrtools/metadata.py`, `schema.py`, `export.py` | `animal` category, schema 1.1.0 |
| `scripts/select_seed.py` | choose seed accessions from ENA (dev tool, network) |
| `data/seed_accessions.txt`, `data/README.md` | committed seed list and how it was chosen |
| `.github/workflows/seed-dataset.yml` | sharded pipeline run → dataset artifact |
| `scripts/publish-dataset.sh` | validate and publish a dataset Release |
| `dashboard/src/data/connection.ts` | `Connection` interface, `runScript` |
| `dashboard/src/data/sql/*.sql` | views and panel queries |
| `dashboard/src/data/filters.ts` | `Filters`, `toWhere` |
| `dashboard/src/data/queries.ts` | typed panel query functions |
| `dashboard/src/data/csv.ts` | CSV export |
| `dashboard/src/data/manifest.ts` | manifest type, `checkSchema`, `loadManifest` |
| `dashboard/src/data/db.ts` | DuckDB-WASM setup (browser only) |
| `dashboard/src/components/*` | UI |
| `dashboard/tests/*` | Vitest + Playwright |
| `.github/workflows/pages.yml` | build and deploy the site |

---

### Task 1: Schema 1.1.0 — `animal` source category

**Files:**
- Modify: `src/amrtools/metadata.py`, `src/amrtools/schema.py`, `src/amrtools/export.py`, `pyproject.toml`, `nextflow.config`, `.github/workflows/ci.yml`, `tests/python/test_metadata.py`, `tests/python/test_export.py`, `tests/python/test_package.py`
- Create: `schemas/v1.1.0/*.json` (generated)

**Interfaces:**
- Produces: `categorize_source(raw: str | None, host: str | None = None) -> str`; `SOURCE_CATEGORIES` includes `"animal"`; `SCHEMA_VERSION = "1.1.0"`

- [ ] **Step 1: Failing tests** — append to `tests/python/test_metadata.py`:

```python
@pytest.mark.parametrize(
    ("raw", "host", "expected"),
    [
        ("pig feces", "Sus scrofa", "animal"),
        ("faeces", "Bos taurus", "animal"),
        ("not provided", "Canis lupus familiaris", "animal"),
        ("farm wastewater", "Sus scrofa", "environmental"),
        ("rectal swab", "Homo sapiens", "screening"),
        ("rectal swab", "homo sapiens ", "screening"),
        ("rectal swab", "not provided", "screening"),
        ("rectal swab", None, "screening"),
    ],
)
def test_non_human_host_is_animal(raw, host, expected):
    assert categorize_source(raw, host) == expected
```
Append to `tests/python/test_export.py`:
```python
def test_animal_host_category_reaches_samples_table(tmp_path):
    sheet = tmp_path / "sheet.csv"
    sheet.write_text(
        "sample,fastq_1,fastq_2,sample_type,organism,isolation_source,host\n"
        "S1,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae,pig feces,Sus scrofa\n"
    )
    (row,) = run_export(tmp_path, sheet, ["S1"])["samples"].to_pylist()
    assert row["source_category"] == "animal"
```
Run: `.venv/bin/pytest -q tests/python/test_metadata.py tests/python/test_export.py` → Expected: new tests FAIL (`TypeError` extra argument / `screening != animal`).

- [ ] **Step 2: Implement**

`src/amrtools/metadata.py` — replace `categorize_source`:
```python
def _is_human(host: str | None) -> bool:
    return is_missing(host) or host.strip().lower() == "homo sapiens"


def categorize_source(raw: str | None, host: str | None = None) -> str:
    text = "" if is_missing(raw) else raw.lower()
    for category, pattern in _SOURCE_PATTERNS:
        if pattern.search(text):
            if category != "environmental" and not _is_human(host):
                return "animal"
            return category
    return "unknown" if _is_human(host) else "animal"
```
`src/amrtools/schema.py`: add `"animal"` to `SOURCE_CATEGORIES` (before `"unknown"`); `SCHEMA_VERSION = "1.1.0"`.
`src/amrtools/export.py`: `"source_category": categorize_source(row.get("isolation_source"), row.get("host")),`.
Version 0.3.0 in `pyproject.toml`, `nextflow.config` (manifest + `amrtools_container`), `ci.yml` (`AMRTOOLS_IMAGE`), `test_package.py`.

- [ ] **Step 3: Regenerate schema JSON and run tests**

Run: `.venv/bin/pip install -q -e ".[dev,pipeline]" && .venv/bin/amrtools schema --export schemas && .venv/bin/pytest -q`
Expected: all pass; `schemas/v1.1.0/` created, `schemas/v1.0.0/` untouched.

- [ ] **Step 4: Commit**
```bash
git add src/amrtools schemas pyproject.toml nextflow.config .github/workflows/ci.yml tests/python
git commit -m "feat(amrtools): animal source category; schema 1.1.0, version 0.3.0"
```

---

### Task 2: Seed accessions, seed workflow and publish script

**Files:**
- Create: `scripts/select_seed.py`, `data/seed_accessions.txt`, `data/README.md`, `.github/workflows/seed-dataset.yml`, `scripts/publish-dataset.sh`

**Interfaces:**
- Produces: workflow artifact `seed-dataset` containing `dataset/` (3 Parquet + manifest.json), `samples.csv`, `samples.skipped.csv`; `scripts/publish-dataset.sh <run-id>` creates Release `dataset-YYYY-MM-DD`.

- [ ] **Step 1: Write `scripts/select_seed.py`**

```python
"""Choose ~30 seed isolates from ENA: real K. pneumoniae Illumina runs, spread over
countries and years, plus runs from two studies known to carry carbapenemases.

Dev tool (needs network). Writes data/seed_accessions.txt deterministically for a
given ENA snapshot; the date and query are recorded in data/README.md.
"""

import csv
import io
import random
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode

from amrtools.ena import http_get
from amrtools.metadata import clean_country, clean_date

SEARCH = "https://www.ebi.ac.uk/ena/portal/api/search"
QUERY = 'tax_eq(573) AND instrument_platform="ILLUMINA" AND library_layout="PAIRED"'
CARBAPENEMASE_STUDIES = {"PRJNA376414": 3, "PRJEB50614": 3}  # KPC (Houston), NDM (India)
SPREAD_TARGET = 24
MIN_BASES, MAX_BASES = 250_000_000, 1_000_000_000  # ~45x-180x of 5.5 Mb


def search(query: str, limit: int) -> list[dict]:
    params = {"result": "read_run", "query": query, "limit": limit, "format": "tsv",
              "fields": "run_accession,study_accession,collection_date,country,base_count"}  # fmt: skip
    return list(
        csv.DictReader(io.StringIO(http_get(f"{SEARCH}?{urlencode(params)}")), delimiter="\t")
    )


def usable(row: dict) -> bool:
    year, _, _ = clean_date(row["collection_date"])
    country, _ = clean_country(row["country"])
    bases = int(row["base_count"] or 0)
    return year is not None and country is not None and MIN_BASES <= bases <= MAX_BASES


def main(out: Path) -> None:
    rng = random.Random(20261008)
    chosen: list[str] = []
    for study, n in CARBAPENEMASE_STUDIES.items():
        rows = [r for r in search(f'{QUERY} AND study_accession="{study}"', 500) if usable(r)]
        chosen += sorted(rng.sample(sorted(r["run_accession"] for r in rows), n))
    by_country: dict[str, list[dict]] = defaultdict(list)
    for row in search(QUERY, 20000):
        if usable(row) and row["study_accession"] not in CARBAPENEMASE_STUDIES:
            by_country[clean_country(row["country"])[0]].append(row)
    countries = sorted(by_country, key=lambda c: (-len(by_country[c]), c))
    for rows in by_country.values():
        rng.shuffle(rows)
    spread: list[str] = []
    while len(spread) < SPREAD_TARGET and any(by_country.values()):
        for country in countries:
            if by_country[country] and len(spread) < SPREAD_TARGET:
                spread.append(by_country[country].pop()["run_accession"])
    out.write_text("\n".join(chosen + sorted(spread)) + "\n")
    print(f"wrote {len(chosen) + len(spread)} accessions to {out}", file=sys.stderr)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "data/seed_accessions.txt"))
```

- [ ] **Step 2: Run it and check the spread**

```bash
mkdir -p data && .venv/bin/python scripts/select_seed.py data/seed_accessions.txt
.venv/bin/amrtools fetch-samples --accession-file data/seed_accessions.txt --organism Klebsiella_pneumoniae --out /tmp-free-path/seed_check.csv
```
(Use the session scratchpad for `seed_check.csv`.) Expected: 30 accessions, 0 skipped; with Python, count distinct cleaned countries (≥ 8) and years (≥ 5) in `seed_check.csv`. If fewer, raise `SPREAD_TARGET`'s country round-robin by lowering `MIN_BASES` to 200 Mb and rerun; record any change in `data/README.md`.

- [ ] **Step 3: Write `data/README.md`**

```markdown
# Seed dataset

`seed_accessions.txt` lists ~30 public *Klebsiella pneumoniae* Illumina paired-end runs
used to build the dashboard's first real dataset on GitHub Actions (no cloud cost).

Chosen on 2026-10-08 by `scripts/select_seed.py` from the ENA Portal API
(`tax_eq(573) AND instrument_platform="ILLUMINA" AND library_layout="PAIRED"`):

- 3 runs each from PRJNA376414 (KPC study, Houston) and PRJEB50614 (NDM study, India),
  so carbapenemases are represented;
- 24 more, one country at a time (round robin), from runs with a collection year, a
  recognised country and 250 Mb–1 Gb of sequence (about 45x–180x).

ENA changes over time, so rerunning the script later can pick different runs; this
committed list is the record. Results are public data and demonstrate a method, not
surveillance findings.
```

- [ ] **Step 4: Write `.github/workflows/seed-dataset.yml`** (pin actions to the same SHAs as `ci.yml`)

```yaml
name: Seed dataset

on:
  workflow_dispatch:

permissions:
  contents: read

env:
  NXF_VER: "26.04.6"
  AMRTOOLS_IMAGE: ghcr.io/simomounir/amrtools:0.3.0

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 330
    strategy:
      fail-fast: false
      matrix:
        shard: [0, 1, 2]
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-java@de7274f081f381c8f8158605e0321c36c376e2e6 # v6.0.1
        with:
          distribution: temurin
          java-version: "21"
      - uses: nf-core/setup-nextflow@893c28b667aedeba26e37f296d260ccc5bc4d914 # v3.0.1
        with:
          version: ${{ env.NXF_VER }}
      - name: Build amrtools image
        run: docker build -f containers/amrtools/Dockerfile -t "$AMRTOOLS_IMAGE" .
      - name: Weekly AMRFinderPlus database cache key
        id: dbkey
        run: echo "week=$(date -u +%G-%V)" >> "$GITHUB_OUTPUT"
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        id: dbcache
        with:
          path: amrfinderdb.tar.gz
          key: amrfinderdb-4.2.7-${{ steps.dbkey.outputs.week }}
      - name: Download AMRFinderPlus database
        if: steps.dbcache.outputs.cache-hit != 'true'
        run: |
          docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/work" -w /work quay.io/biocontainers/ncbi-amrfinderplus:4.2.7--hf69ffd2_0 \
            sh -c 'amrfinder_update -d amrfinderdb && tar czf amrfinderdb.tar.gz -C "amrfinderdb/$(readlink amrfinderdb/latest)" . && rm -rf amrfinderdb'
      - name: Samplesheet for this shard
        run: |
          awk 'NF && (NR - 1) % 3 == ${{ matrix.shard }}' data/seed_accessions.txt > shard.txt
          docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/work" -w /work "$AMRTOOLS_IMAGE" \
            amrtools fetch-samples --accession-file shard.txt --organism Klebsiella_pneumoniae --out samples.csv
      - name: Run pipeline
        run: |
          nextflow run . -profile docker --input samples.csv --outdir results \
            --amrfinder_db "$PWD/amrfinderdb.tar.gz" -with-report results/report.html
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        if: always()
        with:
          name: seed-shard-${{ matrix.shard }}
          path: |
            results/parquet/
            results/report.html
            samples.csv
            samples.skipped.csv

  combine:
    needs: run
    runs-on: ubuntu-latest
    env:
      AMRTOOLS_IMAGE: ghcr.io/simomounir/amrtools:0.3.0
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/download-artifact@<SHA resolved in Step 6> # v7
        with:
          pattern: seed-shard-*
          path: shards
      - name: Build amrtools image
        run: docker build -f containers/amrtools/Dockerfile -t "$AMRTOOLS_IMAGE" .
      - name: Build dataset
        run: |
          docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/work" -w /work "$AMRTOOLS_IMAGE" \
            amrtools build-dataset shards/seed-shard-0/results/parquet shards/seed-shard-1/results/parquet shards/seed-shard-2/results/parquet --out dataset
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: seed-dataset
          path: dataset/
```

- [ ] **Step 5: Write `scripts/publish-dataset.sh`**

```bash
#!/usr/bin/env bash
# Publish a dataset artifact from a workflow run as GitHub Release dataset-YYYY-MM-DD.
# Usage: scripts/publish-dataset.sh <workflow-run-id> [artifact-name]
set -euo pipefail

RUN_ID=${1:?usage: publish-dataset.sh <workflow-run-id> [artifact-name]}
ARTIFACT=${2:-seed-dataset}
TAG="dataset-$(date -u +%F)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

if gh release view "$TAG" >/dev/null 2>&1; then
    echo "error: release $TAG already exists" >&2
    exit 1
fi
gh run download "$RUN_ID" --name "$ARTIFACT" --dir "$WORK/dataset"
amrtools validate "$WORK/dataset"
gh release create "$TAG" "$WORK"/dataset/*.parquet "$WORK/dataset/manifest.json" \
    --title "Dataset $(date -u +%F)" \
    --notes "Results dataset (schema $(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['schema_version'])" "$WORK/dataset/manifest.json")) from workflow run $RUN_ID. Public data; demonstrates a method, not surveillance findings."
echo "published $TAG"
```

- [ ] **Step 6: Resolve the download-artifact SHA, lint, commit**

```bash
gh api repos/actions/download-artifact/releases/latest -q .tag_name
gh api repos/actions/download-artifact/commits/<that tag> -q .sha
```
Put `<sha> # <tag>` into the workflow. Then:
```bash
chmod +x scripts/publish-dataset.sh
.venv/bin/pre-commit run --all-files
git add scripts data .github/workflows/seed-dataset.yml
git commit -m "feat: seed dataset accessions, sharded seed workflow and publish script"
```

---

### Task 3: Dashboard scaffold, toolchain and fixture dataset

**Files:**
- Create: `dashboard/package.json`, `dashboard/tsconfig.json`, `dashboard/vite.config.ts`, `dashboard/eslint.config.js`, `dashboard/index.html`, `dashboard/.gitignore`, `dashboard/tests/fixtures/make_fixture.py`, `dashboard/tests/fixtures/data/*` (generated), `dashboard/tests/nodeConnection.ts`, `dashboard/src/data/connection.ts`, `dashboard/tests/connection.test.ts`
- Modify: `.pre-commit-config.yaml` (exclude `dashboard/tests/fixtures/data/`), `dashboard/README.md`

**Interfaces:**
- Produces:
  - `type Row = Record<string, unknown>`; `interface Connection { query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]> }`; `runScript(conn, sql)` (splits on `;` at line ends)
  - test helper `fixtureConnection(): Promise<Connection>` (tables `samples`, `amr_genes`, `run_summary` from fixture Parquet) and `emptyConnection()`
  - fixture dataset with isolates F1–F6 (table below)

Fixture isolates (all `Klebsiella_pneumoniae`, run `fx`):

| sample | country | year | source | ST | qc | AMR elements (gene / class / subclass / subtype) |
|---|---|---|---|---|---|---|
| F1 | Germany | 2019 | blood | ST258 | pass | blaKPC-2 BETA-LACTAM/CARBAPENEM/AMR; blaCTX-M-15 BETA-LACTAM/CEPHALOSPORIN/AMR |
| F2 | Germany | 2021 | urine | ST147 | pass | blaNDM-5 BETA-LACTAM/CARBAPENEM/AMR; blaCTX-M-15 BETA-LACTAM/CEPHALOSPORIN/AMR |
| F3 | India | 2021 | wound | ST147 | pass | blaNDM-1 BETA-LACTAM/CARBAPENEM/AMR; blaOXA-232 BETA-LACTAM/CARBAPENEM/AMR |
| F4 | United States | — | screening | ST23 | pass | blaCTX-M-14 BETA-LACTAM/CEPHALOSPORIN/AMR; ompK36_D135DGD BETA-LACTAM/CARBAPENEM/POINT; iutA (VIRULENCE) |
| F5 | India | 2020 | respiratory | ST11 | warn | blaKPC-3 BETA-LACTAM/CARBAPENEM/AMR |
| F6 | Côte d'Ivoire | 2018 | other_clinical | ST15 | pass | — |

- [ ] **Step 1: Install Node 22 (user-level)**

```bash
V=$(curl -sf https://nodejs.org/dist/index.json | python3 -c "import json,sys;print(next(r['version'] for r in json.load(sys.stdin) if r['version'].startswith('v22.')))")
mkdir -p ~/.local && curl -sfL "https://nodejs.org/dist/$V/node-$V-darwin-arm64.tar.gz" | tar xz -C ~/.local && rm -rf ~/.local/node22 && mv ~/.local/node-$V-darwin-arm64 ~/.local/node22
export PATH="$HOME/.local/node22/bin:$PATH" && node --version
```
Expected: `v22.x`.

- [ ] **Step 2: Project files**

`dashboard/package.json`:
```json
{
  "name": "amr-dashboard",
  "private": true,
  "version": "0.3.0",
  "type": "module",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "fixture-data": "rm -rf public/data && mkdir -p public/data && cp tests/fixtures/data/* public/data/ && echo dataset-fixture > public/data/TAG",
    "preview:fixture": "npm run fixture-data && vite build && vite preview --port 4173 --strictPort",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@duckdb/duckdb-wasm": "1.32.0",
    "@observablehq/plot": "0.6.17",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@duckdb/node-api": "1.4.5-r.1",
    "@eslint/js": "10.0.1",
    "@playwright/test": "1.64.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "eslint": "10.12.0",
    "eslint-plugin-react-hooks": "7.1.1",
    "typescript": "5.9.3",
    "typescript-eslint": "8.71.1",
    "vite": "8.3.3",
    "vitest": "5.0.3"
  }
}
```
(If `@eslint/js@10.0.1` does not exist, use the latest `10.x` from `npm view @eslint/js version`.)

`dashboard/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "vite.config.ts", "playwright.config.ts"]
}
```
Add `"@types/node": "22.x latest exact"` to devDependencies (resolve with `npm view @types/node@22 version | tail -1`).

`dashboard/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000 },
});
```

`dashboard/eslint.config.js`:
```js
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "public", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
```

`dashboard/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Antimicrobial resistance in public Klebsiella pneumoniae genomes" />
    <title>AMR Explorer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`dashboard/.gitignore`:
```
node_modules/
dist/
public/data/
playwright-report/
test-results/
```

`.pre-commit-config.yaml`: extend `exclude` to `^(modules/nf-core/|tests/python/fixtures/|tests/data/stub/|dashboard/tests/fixtures/data/)`.

Run: `cd dashboard && npm install && npx playwright install chromium`
Expected: `package-lock.json` created, no errors.

- [ ] **Step 3: Fixture generator** `dashboard/tests/fixtures/make_fixture.py`

```python
"""Write the dashboard's fixture dataset (isolates F1-F6) with amrtools, so it uses the
real schema. Run from the repo root: .venv/bin/python dashboard/tests/fixtures/make_fixture.py
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tests" / "python"))

from dataset_helpers import gene_record, sample_record, summary_record, write_run  # noqa: E402

from amrtools.dataset import build_dataset  # noqa: E402

ISOLATES = {
    "F1": ("Germany", 2019, "blood", "ST258", "pass"),
    "F2": ("Germany", 2021, "urine", "ST147", "pass"),
    "F3": ("India", 2021, "wound", "ST147", "pass"),
    "F4": ("United States", None, "screening", "ST23", "pass"),
    "F5": ("India", 2020, "respiratory", "ST11", "warn"),
    "F6": ("Côte d'Ivoire", 2018, "other_clinical", "ST15", "pass"),
}
GENES = {
    "F1": [("blaKPC-2", "CARBAPENEM", "AMR", "AMR"), ("blaCTX-M-15", "CEPHALOSPORIN", "AMR", "AMR")],
    "F2": [("blaNDM-5", "CARBAPENEM", "AMR", "AMR"), ("blaCTX-M-15", "CEPHALOSPORIN", "AMR", "AMR")],
    "F3": [("blaNDM-1", "CARBAPENEM", "AMR", "AMR"), ("blaOXA-232", "CARBAPENEM", "AMR", "AMR")],
    "F4": [("blaCTX-M-14", "CEPHALOSPORIN", "AMR", "AMR"),
           ("ompK36_D135DGD", "CARBAPENEM", "AMR", "POINT"),
           ("iutA", None, "VIRULENCE", "VIRULENCE")],
    "F5": [("blaKPC-3", "CARBAPENEM", "AMR", "AMR")],
    "F6": [],
}  # fmt: skip


def main() -> None:
    staging = ROOT / "dashboard" / "tests" / "fixtures" / "run"
    out = ROOT / "dashboard" / "tests" / "fixtures" / "data"
    shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(out, ignore_errors=True)
    samples, summaries, genes = [], [], []
    for sample, (country, year, source, st, qc) in ISOLATES.items():
        samples.append(sample_record(
            sample, run_id="fx", run_accession=f"SRR{sample[1]}000000", country=country,
            collection_year=year, collection_date_precision="year" if year else "missing",
            source_category=source))  # fmt: skip
        summaries.append(summary_record(sample, run_id="fx", st=st, qc_status=qc,
                                        qc_reasons="" if qc == "pass" else "n_contigs"))  # fmt: skip
        for symbol, subclass, element_type, subtype in GENES[sample]:
            genes.append(gene_record(
                sample, run_id="fx", gene_symbol=symbol, element_name=symbol,
                element_type=element_type, element_subtype=subtype,
                drug_class="BETA-LACTAM" if subclass else None, drug_subclass=subclass))  # fmt: skip
    write_run(staging, samples, genes, summaries)
    build_dataset([staging], out)
    shutil.rmtree(staging)
    print(f"fixture dataset written to {out}")


if __name__ == "__main__":
    main()
```
Run: `.venv/bin/python dashboard/tests/fixtures/make_fixture.py`
Expected: `dashboard/tests/fixtures/data/{samples,amr_genes,run_summary}.parquet` and `manifest.json`.

- [ ] **Step 4: Failing test** `dashboard/tests/connection.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { runScript } from "../src/data/connection";
import { fixtureConnection } from "./nodeConnection";

describe("connection", () => {
  it("reads the fixture tables with plain JS numbers", async () => {
    const conn = await fixtureConnection();
    const rows = await conn.query<{ n: number }>("SELECT count(*)::INTEGER AS n FROM samples");
    expect(rows).toEqual([{ n: 6 }]);
  });

  it("binds parameters", async () => {
    const conn = await fixtureConnection();
    const rows = await conn.query("SELECT sample FROM samples WHERE country = ? ORDER BY sample", ["Côte d'Ivoire"]);
    expect(rows).toEqual([{ sample: "F6" }]);
  });

  it("runs multi-statement scripts", async () => {
    const conn = await fixtureConnection();
    await runScript(conn, "CREATE VIEW a AS SELECT 1 AS x;\nCREATE VIEW b AS SELECT x + 1 AS y FROM a;\n");
    expect(await conn.query("SELECT y::INTEGER AS y FROM b")).toEqual([{ y: 2 }]);
  });
});
```
Run: `cd dashboard && npx vitest run tests/connection.test.ts` → Expected: FAIL (cannot resolve `../src/data/connection`).

- [ ] **Step 5: Implement** `dashboard/src/data/connection.ts`

```ts
export type Row = Record<string, unknown>;

export interface Connection {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Run several statements separated by ';' at line ends (views.sql style). */
export async function runScript(conn: Connection, script: string): Promise<void> {
  for (const statement of script.split(/;\s*(?:\n|$)/)) {
    if (statement.trim()) await conn.query(statement);
  }
}
```
`dashboard/tests/nodeConnection.ts`:
```ts
import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { fileURLToPath } from "node:url";
import type { Connection, Row } from "../src/data/connection";

const FIXTURE = fileURLToPath(new URL("./fixtures/data/", import.meta.url));
export const TABLES = ["samples", "amr_genes", "run_summary"] as const;

export async function emptyConnection(): Promise<Connection> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
      const reader = await conn.runAndReadAll(sql, params as DuckDBValue[]);
      return reader.getRowObjectsJS() as T[];
    },
  };
}

export async function fixtureConnection(directory = FIXTURE): Promise<Connection> {
  const conn = await emptyConnection();
  for (const table of TABLES) {
    await conn.query(`CREATE VIEW ${table} AS SELECT * FROM read_parquet('${directory}${table}.parquet')`);
  }
  return conn;
}
```
Run: `npx vitest run tests/connection.test.ts` → Expected: 3 passed. If `getRowObjectsJS` returns `bigint` for an INTEGER cast or `runAndReadAll` rejects plain JS values, check the `@duckdb/node-api` README for the 1.4.5 API and adapt only `nodeConnection.ts`; the tests stay the same.

- [ ] **Step 6: Commit**
```bash
git add .pre-commit-config.yaml dashboard
git commit -m "feat(dashboard): scaffold, toolchain, fixture dataset and query connection"
```

---

### Task 4: Shared views and filters

**Files:**
- Create: `dashboard/src/data/sql/views.sql`, `dashboard/src/data/filters.ts`, `dashboard/src/data/views.ts`, `dashboard/tests/filters.test.ts`, `dashboard/tests/views.test.ts`

**Interfaces:**
- Produces:
  - views `carbapenemases(sample, gene_symbol, family)`, `esbl(sample, gene_symbol)`, `isolates(sample, run_accession, country, region, collection_year, source_category, st, qc_status, carbapenemase_genes, ctxm_genes, has_carbapenemase, has_ctxm)`
  - `createViews(conn: Connection): Promise<void>`
  - `interface Filters { countries: string[]; sources: string[]; sts: string[]; yearMin: number | null; yearMax: number | null; carbapenemaseOnly: boolean; hideQcWarnings: boolean }`, `EMPTY_FILTERS`, `type ListFilter = "countries" | "sources" | "sts"`, `toWhere(filters: Filters, omit?: ListFilter): { sql: string; params: unknown[] }`

- [ ] **Step 1: Failing tests**

`dashboard/tests/filters.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, toWhere } from "../src/data/filters";

describe("toWhere", () => {
  it("hides QC warnings by default", () => {
    expect(toWhere(EMPTY_FILTERS)).toEqual({ sql: "WHERE qc_status = 'pass'", params: [] });
  });

  it("is empty when nothing is filtered", () => {
    expect(toWhere({ ...EMPTY_FILTERS, hideQcWarnings: false })).toEqual({ sql: "", params: [] });
  });

  it("passes user values only as parameters", () => {
    const where = toWhere({ ...EMPTY_FILTERS, hideQcWarnings: false, countries: ["Côte d'Ivoire", "x'); DROP TABLE samples;--"] });
    expect(where.sql).toBe("WHERE country IN (?, ?)");
    expect(where.params).toEqual(["Côte d'Ivoire", "x'); DROP TABLE samples;--"]);
  });

  it("combines all filters in a fixed order", () => {
    const where = toWhere({
      countries: ["India"], sources: ["wound"], sts: ["ST147"], yearMin: 2019, yearMax: 2021,
      carbapenemaseOnly: true, hideQcWarnings: true,
    });
    expect(where.sql).toBe(
      "WHERE country IN (?) AND source_category IN (?) AND st IN (?) AND collection_year >= ? AND collection_year <= ? AND has_carbapenemase AND qc_status = 'pass'",
    );
    expect(where.params).toEqual(["India", "wound", "ST147", 2019, 2021]);
  });

  it("can omit one list filter (for that filter's own option counts)", () => {
    const where = toWhere({ ...EMPTY_FILTERS, countries: ["India"], sts: ["ST147"] }, "countries");
    expect(where.sql).toBe("WHERE st IN (?) AND qc_status = 'pass'");
    expect(where.params).toEqual(["ST147"]);
  });
});
```

`dashboard/tests/views.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createViews } from "../src/data/views";
import { fixtureConnection } from "./nodeConnection";

describe("views", () => {
  it("classifies acquired carbapenemases by family and ignores point mutations", async () => {
    const conn = await fixtureConnection();
    await createViews(conn);
    const rows = await conn.query("SELECT sample, gene_symbol, family FROM carbapenemases ORDER BY sample, gene_symbol");
    expect(rows).toEqual([
      { sample: "F1", gene_symbol: "blaKPC-2", family: "KPC" },
      { sample: "F2", gene_symbol: "blaNDM-5", family: "NDM" },
      { sample: "F3", gene_symbol: "blaNDM-1", family: "NDM" },
      { sample: "F3", gene_symbol: "blaOXA-232", family: "OXA-48-like" },
      { sample: "F5", gene_symbol: "blaKPC-3", family: "KPC" },
    ]);
  });

  it("builds one isolate row per sample with joined gene lists", async () => {
    const conn = await fixtureConnection();
    await createViews(conn);
    const rows = await conn.query(
      "SELECT sample, carbapenemase_genes, ctxm_genes, has_carbapenemase, has_ctxm FROM isolates ORDER BY sample",
    );
    expect(rows[2]).toEqual({ sample: "F3", carbapenemase_genes: "blaNDM-1, blaOXA-232", ctxm_genes: null, has_carbapenemase: true, has_ctxm: false });
    expect(rows[3]).toEqual({ sample: "F4", carbapenemase_genes: null, ctxm_genes: "blaCTX-M-14", has_carbapenemase: false, has_ctxm: true });
    expect(rows).toHaveLength(6);
  });
});
```
Run: `npx vitest run tests/filters.test.ts tests/views.test.ts` → Expected: FAIL (modules missing).

- [ ] **Step 2: Implement**

`dashboard/src/data/sql/views.sql`:
```sql
CREATE OR REPLACE VIEW carbapenemases AS
SELECT DISTINCT
    sample,
    gene_symbol,
    CASE
        WHEN gene_symbol LIKE 'blaKPC%' THEN 'KPC'
        WHEN gene_symbol LIKE 'blaNDM%' THEN 'NDM'
        WHEN gene_symbol LIKE 'blaVIM%' THEN 'VIM'
        WHEN gene_symbol LIKE 'blaIMP%' THEN 'IMP'
        WHEN gene_symbol LIKE 'blaOXA%' THEN 'OXA-48-like'
        ELSE 'other'
    END AS family
FROM amr_genes
WHERE element_subtype = 'AMR' AND drug_subclass = 'CARBAPENEM';

CREATE OR REPLACE VIEW esbl AS
SELECT DISTINCT sample, gene_symbol
FROM amr_genes
WHERE gene_symbol LIKE 'blaCTX-M%';

CREATE OR REPLACE VIEW isolates AS
SELECT
    s.sample,
    s.run_accession,
    s.country,
    s.region,
    s.collection_year::INTEGER AS collection_year,
    s.source_category,
    r.st,
    r.qc_status,
    (SELECT string_agg(c.gene_symbol, ', ' ORDER BY c.gene_symbol) FROM carbapenemases c WHERE c.sample = s.sample) AS carbapenemase_genes,
    (SELECT string_agg(e.gene_symbol, ', ' ORDER BY e.gene_symbol) FROM esbl e WHERE e.sample = s.sample) AS ctxm_genes,
    EXISTS (SELECT 1 FROM carbapenemases c WHERE c.sample = s.sample) AS has_carbapenemase,
    EXISTS (SELECT 1 FROM esbl e WHERE e.sample = s.sample) AS has_ctxm
FROM samples s
JOIN run_summary r USING (sample);
```

`dashboard/src/data/views.ts`:
```ts
import type { Connection } from "./connection";
import { runScript } from "./connection";
import viewsSql from "./sql/views.sql?raw";

export function createViews(conn: Connection): Promise<void> {
  return runScript(conn, viewsSql);
}
```

`dashboard/src/data/filters.ts`:
```ts
export interface Filters {
  countries: string[];
  sources: string[];
  sts: string[];
  yearMin: number | null;
  yearMax: number | null;
  carbapenemaseOnly: boolean;
  hideQcWarnings: boolean;
}

export type ListFilter = "countries" | "sources" | "sts";

export const EMPTY_FILTERS: Filters = {
  countries: [],
  sources: [],
  sts: [],
  yearMin: null,
  yearMax: null,
  carbapenemaseOnly: false,
  hideQcWarnings: true,
};

const LIST_COLUMNS: Record<ListFilter, string> = {
  countries: "country",
  sources: "source_category",
  sts: "st",
};

/** Filters -> WHERE clause over the `isolates` view. User values only ever become `?` params. */
export function toWhere(filters: Filters, omit?: ListFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(LIST_COLUMNS) as ListFilter[]) {
    const values = filters[key];
    if (key === omit || values.length === 0) continue;
    clauses.push(`${LIST_COLUMNS[key]} IN (${values.map(() => "?").join(", ")})`);
    params.push(...values);
  }
  if (filters.yearMin !== null) {
    clauses.push("collection_year >= ?");
    params.push(filters.yearMin);
  }
  if (filters.yearMax !== null) {
    clauses.push("collection_year <= ?");
    params.push(filters.yearMax);
  }
  if (filters.carbapenemaseOnly) clauses.push("has_carbapenemase");
  if (filters.hideQcWarnings) clauses.push("qc_status = 'pass'");
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}
```
Add `dashboard/src/vite-env.d.ts`: `/// <reference types="vite/client" />`.

Run: `npx vitest run` → Expected: all pass.

- [ ] **Step 3: Commit**
```bash
git add dashboard
git commit -m "feat(dashboard): shared SQL views and parameterised filters"
```

---

### Task 5: Panel queries

**Files:**
- Create: `dashboard/src/data/sql/{headline,timeline,heatmap,isolates,options,years}.sql`, `dashboard/src/data/queries.ts`, `dashboard/tests/queries.test.ts`

**Interfaces:**
- Consumes: `Connection`, `createViews`, `Filters`, `toWhere`
- Produces (all `(conn: Connection, filters: Filters) => Promise<...>` except `yearBounds`):
  - `headline` → `{ isolates: number; carbapenemase_share: number; ctxm_share: number; countries: number; year_min: number | null; year_max: number | null; year_known_share: number }`
  - `timeline` → `{ year: string; family: string; isolates: number }[]` (year `"undated"` for missing; family `"none"` without carbapenemase)
  - `heatmap` → `{ gene_symbol: string; drug_class: string; carriers: number; share: number }[]` (top 20)
  - `isolateRows` → `IsolateRow[]` with `sample, run_accession, country, collection_year, source_category, st, carbapenemase_genes, ctxm_genes, qc_status`
  - `options(conn, filters, key: ListFilter)` → `{ value: string; isolates: number }[]`
  - `yearBounds(conn)` → `{ min: number | null; max: number | null }`

- [ ] **Step 1: Failing tests** `dashboard/tests/queries.test.ts`

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { Connection } from "../src/data/connection";
import { EMPTY_FILTERS } from "../src/data/filters";
import { headline, heatmap, isolateRows, options, timeline, yearBounds } from "../src/data/queries";
import { createViews } from "../src/data/views";
import { fixtureConnection } from "./nodeConnection";

let conn: Connection;
beforeAll(async () => {
  conn = await fixtureConnection();
  await createViews(conn);
});

const ALL = { ...EMPTY_FILTERS, hideQcWarnings: false };

describe("headline", () => {
  it("summarises QC-passing isolates by default", async () => {
    expect(await headline(conn, EMPTY_FILTERS)).toEqual({
      isolates: 5, carbapenemase_share: 0.6, ctxm_share: 0.6, countries: 4,
      year_min: 2018, year_max: 2021, year_known_share: 0.8,
    });
  });

  it("returns zeros, not NaN, when nothing matches", async () => {
    const result = await headline(conn, { ...EMPTY_FILTERS, countries: ["Atlantis"] });
    expect(result).toEqual({ isolates: 0, carbapenemase_share: 0, ctxm_share: 0, countries: 0, year_min: null, year_max: null, year_known_share: 0 });
  });

  it("filters by a country containing an apostrophe", async () => {
    expect((await headline(conn, { ...EMPTY_FILTERS, countries: ["Côte d'Ivoire"] })).isolates).toBe(1);
  });
});

describe("timeline", () => {
  it("counts isolates per year and family with undated kept separate", async () => {
    expect(await timeline(conn, EMPTY_FILTERS)).toEqual([
      { year: "2018", family: "none", isolates: 1 },
      { year: "2019", family: "KPC", isolates: 1 },
      { year: "2021", family: "NDM", isolates: 2 },
      { year: "2021", family: "OXA-48-like", isolates: 1 },
      { year: "undated", family: "none", isolates: 1 },
    ]);
  });

  it("drops undated isolates when a year range is set", async () => {
    const rows = await timeline(conn, { ...EMPTY_FILTERS, yearMin: 2019 });
    expect(rows.map((r) => r.year)).not.toContain("undated");
  });
});

describe("heatmap", () => {
  it("ranks AMR elements by carriers with share of shown isolates", async () => {
    const rows = await heatmap(conn, EMPTY_FILTERS);
    expect(rows[0]).toEqual({ gene_symbol: "blaCTX-M-15", drug_class: "BETA-LACTAM", carriers: 2, share: 0.4 });
    expect(rows.map((r) => r.gene_symbol)).toContain("ompK36_D135DGD");
    expect(rows.map((r) => r.gene_symbol)).not.toContain("iutA");
    expect(rows.map((r) => r.gene_symbol)).not.toContain("blaKPC-3"); // F5 hidden by QC
  });
});

describe("isolate table", () => {
  it("lists carbapenemase carriers including QC warnings when shown", async () => {
    const rows = await isolateRows(conn, { ...ALL, carbapenemaseOnly: true });
    expect(rows.map((r) => r.sample)).toEqual(["F1", "F2", "F3", "F5"]);
    expect(rows[2]).toMatchObject({ country: "India", collection_year: 2021, carbapenemase_genes: "blaNDM-1, blaOXA-232", st: "ST147" });
  });
});

describe("filter options", () => {
  it("counts each option under the other filters", async () => {
    expect(await options(conn, EMPTY_FILTERS, "countries")).toEqual([
      { value: "Germany", isolates: 2 },
      { value: "Côte d'Ivoire", isolates: 1 },
      { value: "India", isolates: 1 },
      { value: "United States", isolates: 1 },
    ]);
  });

  it("ignores its own selection so other options stay visible", async () => {
    const rows = await options(conn, { ...ALL, countries: ["India"] }, "countries");
    expect(rows.find((r) => r.value === "India")).toEqual({ value: "India", isolates: 2 });
    expect(rows).toHaveLength(4);
  });

  it("year bounds cover all isolates", async () => {
    expect(await yearBounds(conn)).toEqual({ min: 2018, max: 2021 });
  });
});
```
Run: `npx vitest run tests/queries.test.ts` → Expected: FAIL (module missing).

- [ ] **Step 2: SQL files** (`{{where}}` is replaced by `toWhere(...).sql`)

`headline.sql`:
```sql
SELECT
    count(*)::INTEGER AS isolates,
    coalesce(avg(has_carbapenemase::INTEGER), 0)::DOUBLE AS carbapenemase_share,
    coalesce(avg(has_ctxm::INTEGER), 0)::DOUBLE AS ctxm_share,
    count(DISTINCT country)::INTEGER AS countries,
    min(collection_year)::INTEGER AS year_min,
    max(collection_year)::INTEGER AS year_max,
    coalesce(avg((collection_year IS NOT NULL)::INTEGER), 0)::DOUBLE AS year_known_share
FROM isolates
{{where}}
```
`timeline.sql`:
```sql
WITH shown AS (SELECT sample, collection_year FROM isolates {{where}})
SELECT
    coalesce(CAST(s.collection_year AS VARCHAR), 'undated') AS year,
    coalesce(c.family, 'none') AS family,
    count(DISTINCT s.sample)::INTEGER AS isolates
FROM shown s
LEFT JOIN carbapenemases c USING (sample)
GROUP BY ALL
ORDER BY year, family
```
`heatmap.sql`:
```sql
WITH shown AS (SELECT sample FROM isolates {{where}}),
hits AS (
    SELECT g.gene_symbol, coalesce(g.drug_class, 'unknown') AS drug_class, count(DISTINCT g.sample) AS carriers
    FROM amr_genes g
    JOIN shown USING (sample)
    WHERE g.element_type = 'AMR'
    GROUP BY ALL
)
SELECT
    gene_symbol,
    drug_class,
    carriers::INTEGER AS carriers,
    (carriers / (SELECT count(*) FROM shown))::DOUBLE AS share
FROM hits
ORDER BY carriers DESC, gene_symbol
LIMIT 20
```
`isolates.sql`:
```sql
SELECT sample, run_accession, country, collection_year, source_category, st,
       carbapenemase_genes, ctxm_genes, qc_status
FROM isolates
{{where}}
ORDER BY sample
```
`options.sql` (`{{column}}` is one of three fixed column names, never user input):
```sql
SELECT value, isolates
FROM (
    SELECT {{column}} AS value, count(*)::INTEGER AS isolates
    FROM isolates
    {{where}}
    GROUP BY 1
)
WHERE value IS NOT NULL
ORDER BY isolates DESC, value
```
`years.sql`:
```sql
SELECT min(collection_year)::INTEGER AS min, max(collection_year)::INTEGER AS max FROM isolates
```

- [ ] **Step 3: Implement** `dashboard/src/data/queries.ts`

```ts
import type { Connection } from "./connection";
import { type Filters, type ListFilter, toWhere } from "./filters";
import headlineSql from "./sql/headline.sql?raw";
import heatmapSql from "./sql/heatmap.sql?raw";
import isolatesSql from "./sql/isolates.sql?raw";
import optionsSql from "./sql/options.sql?raw";
import timelineSql from "./sql/timeline.sql?raw";
import yearsSql from "./sql/years.sql?raw";

export interface Headline {
  isolates: number;
  carbapenemase_share: number;
  ctxm_share: number;
  countries: number;
  year_min: number | null;
  year_max: number | null;
  year_known_share: number;
}
export interface TimelineRow { year: string; family: string; isolates: number }
export interface HeatmapRow { gene_symbol: string; drug_class: string; carriers: number; share: number }
export interface IsolateRow {
  sample: string;
  run_accession: string | null;
  country: string | null;
  collection_year: number | null;
  source_category: string;
  st: string | null;
  carbapenemase_genes: string | null;
  ctxm_genes: string | null;
  qc_status: string;
}
export interface OptionRow { value: string; isolates: number }

const OPTION_COLUMNS: Record<ListFilter, string> = {
  countries: "country",
  sources: "source_category",
  sts: "st",
};

function run<T>(conn: Connection, template: string, filters: Filters, omit?: ListFilter) {
  const where = toWhere(filters, omit);
  return conn.query<T & Record<string, unknown>>(template.replace("{{where}}", where.sql), where.params);
}

export async function headline(conn: Connection, filters: Filters): Promise<Headline> {
  const [row] = await run<Headline>(conn, headlineSql, filters);
  return row;
}

export function timeline(conn: Connection, filters: Filters): Promise<TimelineRow[]> {
  return run<TimelineRow>(conn, timelineSql, filters);
}

export function heatmap(conn: Connection, filters: Filters): Promise<HeatmapRow[]> {
  return run<HeatmapRow>(conn, heatmapSql, filters);
}

export function isolateRows(conn: Connection, filters: Filters): Promise<IsolateRow[]> {
  return run<IsolateRow>(conn, isolatesSql, filters);
}

export function options(conn: Connection, filters: Filters, key: ListFilter): Promise<OptionRow[]> {
  return run<OptionRow>(conn, optionsSql.replace("{{column}}", OPTION_COLUMNS[key]), filters, key);
}

export async function yearBounds(conn: Connection): Promise<{ min: number | null; max: number | null }> {
  const [row] = await conn.query<{ min: number | null; max: number | null }>(yearsSql);
  return row;
}
```
Run: `npx vitest run` → Expected: all pass. A `0.6` share may come back as `0.6000000000000001`; if so, round shares in SQL with `round(..., 6)` rather than loosening the test.

- [ ] **Step 4: Commit**
```bash
git add dashboard
git commit -m "feat(dashboard): panel queries with fixture-verified answers"
```

---

### Task 6: CSV export, manifest check and scale test

**Files:**
- Create: `dashboard/src/data/csv.ts`, `dashboard/src/data/manifest.ts`, `dashboard/tests/csv.test.ts`, `dashboard/tests/manifest.test.ts`, `dashboard/tests/scale.test.ts`

**Interfaces:**
- Produces: `toCsv(rows: Row[], columns: string[]): string`; `interface Manifest { schema_version: string; created_at: string; runs: { run_id: string; run_started_at: string; samples: number }[]; tables: Record<string, { file: string; rows: number; sha256: string }> }`; `class DashboardError extends Error`; `checkSchema(manifest: Manifest): void`; `loadManifest(baseUrl: string, fetchFn = fetch): Promise<Manifest>`

- [ ] **Step 1: Failing tests**

`dashboard/tests/csv.test.ts`:
```ts
import { expect, it } from "vitest";
import { toCsv } from "../src/data/csv";

it("quotes commas, quotes and newlines; nulls are empty", () => {
  const csv = toCsv(
    [{ a: "plain", b: 'say "hi"', c: null }, { a: "x, y", b: "line\nbreak", c: 3 }],
    ["a", "b", "c"],
  );
  expect(csv).toBe('a,b,c\nplain,"say ""hi""",\n"x, y","line\nbreak",3\n');
});
```

`dashboard/tests/manifest.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DashboardError, checkSchema, loadManifest, type Manifest } from "../src/data/manifest";

const manifest = (schema_version: string): Manifest => ({ schema_version, created_at: "2026-10-08T00:00:00Z", runs: [], tables: {} });

describe("manifest", () => {
  it("accepts any 1.x schema", () => {
    expect(() => checkSchema(manifest("1.0.0"))).not.toThrow();
    expect(() => checkSchema(manifest("1.7.2"))).not.toThrow();
  });

  it("rejects another major version with a clear message", () => {
    expect(() => checkSchema(manifest("2.0.0"))).toThrow(new DashboardError("Dataset schema 2.0.0 is not supported by this dashboard (needs 1.x)"));
  });

  it("reports an unreachable manifest with its URL", async () => {
    const failing = async () => new Response("nope", { status: 404 });
    await expect(loadManifest("https://example.org/data/", failing)).rejects.toThrow("Dataset unavailable: https://example.org/data/manifest.json (HTTP 404)");
  });
});
```

`dashboard/tests/scale.test.ts`:
```ts
import { expect, it } from "vitest";
import { EMPTY_FILTERS } from "../src/data/filters";
import { headline, heatmap, isolateRows, options, timeline } from "../src/data/queries";
import { createViews } from "../src/data/views";
import { emptyConnection } from "./nodeConnection";

// 10,000 synthetic isolates generated in memory only; never written or published.
it("every panel query finishes within a second at 10,000 isolates", async () => {
  const conn = await emptyConnection();
  await conn.query(`CREATE TABLE samples AS
    SELECT 'S' || i AS sample, 'SRR' || i AS run_accession,
           ['Germany','India','United States','Brazil','Italy'][1 + i % 5] AS country, NULL AS region,
           CASE WHEN i % 7 = 0 THEN NULL ELSE 2010 + i % 15 END::SMALLINT AS collection_year,
           ['blood','urine','wound','screening','unknown'][1 + i % 5] AS source_category
    FROM range(10000) t(i)`);
  await conn.query(`CREATE TABLE run_summary AS
    SELECT 'S' || i AS sample, 'ST' || (i % 40) AS st, CASE WHEN i % 10 = 0 THEN 'warn' ELSE 'pass' END AS qc_status
    FROM range(10000) t(i)`);
  await conn.query(`CREATE TABLE amr_genes AS
    SELECT 'S' || (i % 10000) AS sample, 'gene' || (i % 60) AS gene_symbol, 'AMR' AS element_type, 'AMR' AS element_subtype,
           'BETA-LACTAM' AS drug_class, CASE WHEN i % 9 = 0 THEN 'CARBAPENEM' ELSE 'CEPHALOSPORIN' END AS drug_subclass
    FROM range(440000) t(i)`);
  await createViews(conn);
  for (const query of [headline, timeline, heatmap, isolateRows]) {
    const start = performance.now();
    await query(conn, EMPTY_FILTERS);
    expect(performance.now() - start).toBeLessThan(1000);
  }
  const start = performance.now();
  await options(conn, EMPTY_FILTERS, "countries");
  expect(performance.now() - start).toBeLessThan(1000);
});
```
Run: `npx vitest run` → Expected: csv/manifest FAIL (modules missing); scale may pass already (it exercises Task 5 code) — that is fine, it is a performance guard, not new behaviour.

- [ ] **Step 2: Implement**

`dashboard/src/data/csv.ts`:
```ts
import type { Row } from "./connection";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Row[], columns: string[]): string {
  const lines = [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))];
  return `${lines.join("\n")}\n`;
}
```
`dashboard/src/data/manifest.ts`:
```ts
export interface Manifest {
  schema_version: string;
  created_at: string;
  runs: { run_id: string; run_started_at: string; samples: number }[];
  tables: Record<string, { file: string; rows: number; sha256: string }>;
}

export class DashboardError extends Error {}

export function checkSchema(manifest: Manifest): void {
  const major = Number(manifest.schema_version.split(".")[0]);
  if (major !== 1) {
    throw new DashboardError(`Dataset schema ${manifest.schema_version} is not supported by this dashboard (needs 1.x)`);
  }
}

export async function loadManifest(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<Manifest> {
  const url = new URL("manifest.json", baseUrl).href;
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch {
    throw new DashboardError(`Dataset unavailable: ${url} (network error)`);
  }
  if (!response.ok) throw new DashboardError(`Dataset unavailable: ${url} (HTTP ${response.status})`);
  const manifest = (await response.json()) as Manifest;
  checkSchema(manifest);
  return manifest;
}
```
Run: `npx vitest run` → Expected: all pass.

- [ ] **Step 3: Commit**
```bash
git add dashboard
git commit -m "feat(dashboard): CSV export, manifest schema check and 10k-isolate scale test"
```

---

### Task 7: Browser database, components and smoke test

**Files:**
- Create: `dashboard/src/data/db.ts`, `dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/src/styles.css`, `dashboard/src/useDashboard.ts`, `dashboard/src/components/{FilterBar,Headline,Timeline,Heatmap,IsolateTable,Footer,PlotFigure,Panel}.tsx`, `dashboard/playwright.config.ts`, `dashboard/tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: everything in `src/data`
- Produces: `openDashboardDb(baseUrl: string): Promise<{ conn: Connection; manifest: Manifest; tag: string }>`; app at `dist/`

- [ ] **Step 1: Failing smoke test**

`dashboard/playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:4173/", acceptDownloads: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npm run preview:fixture", url: "http://localhost:4173/", timeout: 120_000 },
});
```
`dashboard/tests/e2e/smoke.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("dashboard renders, filters and exports", async ({ page }) => {
  await page.goto("./");
  const isolates = page.getByTestId("headline-isolates");
  await expect(isolates).toHaveText("5");
  for (const panel of ["Resistance over time", "Most common AMR elements", "Isolates"]) {
    await expect(page.getByRole("heading", { name: panel })).toBeVisible();
  }
  await expect(page.locator("figure svg").first()).toBeVisible();
  await page.getByRole("checkbox", { name: /Germany/ }).check();
  await expect(isolates).toHaveText("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await (await download).createReadStream();
  const text = await new Response(csv as unknown as ReadableStream).text();
  expect(text.split("\n")[0]).toBe("sample,run_accession,country,collection_year,source_category,st,carbapenemase_genes,ctxm_genes,qc_status");
  await expect(page.getByText("Public data; demonstrates a method, not surveillance findings.")).toBeVisible();
});
```
Run: `npm run e2e` → Expected: FAIL (no app; `src/main.tsx` missing makes the build fail).

- [ ] **Step 2: Browser database** `dashboard/src/data/db.ts`

```ts
import * as duckdb from "@duckdb/duckdb-wasm";
import type { Connection, Row } from "./connection";
import { DashboardError, loadManifest, type Manifest } from "./manifest";
import { createViews } from "./views";

const TABLES = ["samples", "amr_genes", "run_summary"] as const;

function wasmConnection(raw: duckdb.AsyncDuckDBConnection): Connection {
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
      let table;
      if (params.length) {
        const statement = await raw.prepare(sql);
        try {
          table = await statement.query(...params);
        } finally {
          await statement.close();
        }
      } else {
        table = await raw.query(sql);
      }
      return table.toArray().map((row) => row.toJSON() as T);
    },
  };
}

export async function openDashboardDb(baseUrl: string): Promise<{ conn: Connection; manifest: Manifest; tag: string }> {
  if (typeof WebAssembly === "undefined") throw new DashboardError("This dashboard needs a current browser (WebAssembly).");
  const manifest = await loadManifest(baseUrl);
  const tag = await fetch(new URL("TAG", baseUrl)).then((r) => (r.ok ? r.text() : "")).then((t) => t.trim());
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = wasmConnection(await db.connect());
  for (const table of TABLES) {
    const url = new URL(`${table}.parquet`, baseUrl).href;
    await db.registerFileURL(`${table}.parquet`, url, duckdb.DuckDBDataProtocol.HTTP, false);
    await conn.query(`CREATE VIEW ${table} AS SELECT * FROM read_parquet('${table}.parquet')`);
  }
  await createViews(conn);
  return { conn, manifest, tag };
}
```

- [ ] **Step 3: State hook** `dashboard/src/useDashboard.ts`

```ts
import { useEffect, useState } from "react";
import type { Connection } from "./data/connection";
import { EMPTY_FILTERS, type Filters } from "./data/filters";
import * as q from "./data/queries";

export interface PanelState<T> { data?: T; error?: string }
export interface DashboardData {
  headline: PanelState<q.Headline>;
  timeline: PanelState<q.TimelineRow[]>;
  heatmap: PanelState<q.HeatmapRow[]>;
  isolates: PanelState<q.IsolateRow[]>;
  countries: PanelState<q.OptionRow[]>;
  sources: PanelState<q.OptionRow[]>;
  sts: PanelState<q.OptionRow[]>;
}

async function settle<T>(promise: Promise<T>): Promise<PanelState<T>> {
  try {
    return { data: await promise };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function useDashboard(conn: Connection | undefined) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<DashboardData | undefined>();
  const [years, setYears] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });

  useEffect(() => {
    if (conn) q.yearBounds(conn).then(setYears, () => undefined);
  }, [conn]);

  useEffect(() => {
    if (!conn) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const [headline, timeline, heatmap, isolates, countries, sources, sts] = await Promise.all([
        settle(q.headline(conn, filters)),
        settle(q.timeline(conn, filters)),
        settle(q.heatmap(conn, filters)),
        settle(q.isolateRows(conn, filters)),
        settle(q.options(conn, filters, "countries")),
        settle(q.options(conn, filters, "sources")),
        settle(q.options(conn, filters, "sts")),
      ]);
      if (!cancelled) setData({ headline, timeline, heatmap, isolates, countries, sources, sts });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conn, filters]);

  return { filters, setFilters, data, years };
}
```

- [ ] **Step 4: Components**

`dashboard/src/components/Panel.tsx`:
```tsx
import type { ReactNode } from "react";

export function Panel({ title, error, empty, onClear, children }: {
  title: string; error?: string; empty?: boolean; onClear?: () => void; children: ReactNode;
}) {
  return (
    <section className="panel" aria-labelledby={`${title}-h`}>
      <h2 id={`${title}-h`}>{title}</h2>
      {error ? (
        <p className="panel-error" role="alert">Could not load this panel: {error}</p>
      ) : empty ? (
        <p className="panel-empty">
          No isolates match these filters. {onClear && <button onClick={onClear}>Clear filters</button>}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
```
`dashboard/src/components/PlotFigure.tsx`:
```tsx
import * as Plot from "@observablehq/plot";
import { useEffect, useRef } from "react";

export function PlotFigure({ options, summary }: { options: Plot.PlotOptions; summary: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const figure = Plot.plot(options);
    ref.current?.replaceChildren(figure);
    return () => figure.remove();
  }, [options]);
  return (
    <figure>
      <div ref={ref} />
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
```
`dashboard/src/components/Headline.tsx`:
```tsx
import type { Headline as HeadlineData } from "../data/queries";

const pct = (share: number) => `${Math.round(share * 100)}%`;

export function Headline({ data }: { data: HeadlineData }) {
  const years = data.year_min === null ? "—" : data.year_min === data.year_max ? `${data.year_min}` : `${data.year_min}–${data.year_max}`;
  const stats = [
    { label: "Isolates", value: String(data.isolates), id: "headline-isolates" },
    { label: "Carry a carbapenemase", value: pct(data.carbapenemase_share) },
    { label: "Carry CTX-M (ESBL)", value: pct(data.ctxm_share) },
    { label: "Countries", value: String(data.countries) },
    { label: "Collection years", value: years, note: `year known for ${pct(data.year_known_share)}` },
  ];
  return (
    <dl className="headline">
      {stats.map((s) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd data-testid={s.id}>{s.value}</dd>
          {s.note && <dd className="note">{s.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
```
`dashboard/src/components/Timeline.tsx`:
```tsx
import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import type { TimelineRow } from "../data/queries";
import { PlotFigure } from "./PlotFigure";

// Okabe-Ito colour-blind-safe palette.
const FAMILIES = ["KPC", "NDM", "OXA-48-like", "VIM", "IMP", "other", "none"];
const COLOURS = ["#D55E00", "#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#BBBBBB"];

export function Timeline({ rows }: { rows: TimelineRow[] }) {
  const options = useMemo<Plot.PlotOptions>(() => ({
    height: 280,
    marginLeft: 40,
    x: { label: "Collection year", type: "band" },
    y: { label: "Isolates", grid: true },
    color: { domain: FAMILIES, range: COLOURS, legend: true },
    marks: [Plot.barY(rows, { x: "year", y: "isolates", fill: "family", tip: true }), Plot.ruleY([0])],
  }), [rows]);
  const total = rows.filter((r) => r.family !== "none").reduce((n, r) => n + r.isolates, 0);
  return <PlotFigure options={options} summary={`${total} carbapenemase detections across ${new Set(rows.map((r) => r.year)).size} year groups`} />;
}
```
`dashboard/src/components/Heatmap.tsx`:
```tsx
import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import type { HeatmapRow } from "../data/queries";
import { PlotFigure } from "./PlotFigure";

export function Heatmap({ rows }: { rows: HeatmapRow[] }) {
  const options = useMemo<Plot.PlotOptions>(() => ({
    height: 40 + rows.length * 22,
    marginLeft: 130,
    x: { label: null, axis: "top" },
    y: { label: null, domain: rows.map((r) => r.gene_symbol) },
    color: { scheme: "blues", domain: [0, 1], legend: true, label: "Share of shown isolates", tickFormat: "%" },
    marks: [
      Plot.cell(rows, { x: "drug_class", y: "gene_symbol", fill: "share", tip: true }),
      Plot.text(rows, { x: "drug_class", y: "gene_symbol", text: (d: HeatmapRow) => `${Math.round(d.share * 100)}%`, fill: (d: HeatmapRow) => (d.share > 0.5 ? "white" : "black") }),
    ],
  }), [rows]);
  return <PlotFigure options={options} summary={`Top ${rows.length} AMR elements; most common ${rows[0]?.gene_symbol ?? "none"}`} />;
}
```
`dashboard/src/components/IsolateTable.tsx`:
```tsx
import { useMemo, useState } from "react";
import { toCsv } from "../data/csv";
import type { IsolateRow } from "../data/queries";

const COLUMNS: (keyof IsolateRow)[] = ["sample", "run_accession", "country", "collection_year", "source_category", "st", "carbapenemase_genes", "ctxm_genes", "qc_status"];
const PAGE = 50;

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function IsolateTable({ rows }: { rows: IsolateRow[] }) {
  const [sort, setSort] = useState<{ key: keyof IsolateRow; asc: boolean }>({ key: "sample", asc: true });
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const x = a[sort.key] ?? "";
    const y = b[sort.key] ?? "";
    return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1);
  }), [rows, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const shown = sorted.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <>
      <div className="table-actions">
        <button onClick={() => download(toCsv(sorted as unknown as Record<string, unknown>[], COLUMNS as string[]), "isolates.csv")}>Download CSV</button>
        <span>{rows.length} isolates</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} aria-sort={sort.key === c ? (sort.asc ? "ascending" : "descending") : "none"}>
                  <button onClick={() => setSort({ key: c, asc: sort.key === c ? !sort.asc : true })}>{c.replace(/_/g, " ")}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.sample}>
                <td>{r.run_accession ? <a href={`https://www.ebi.ac.uk/ena/browser/view/${r.run_accession}`} target="_blank" rel="noreferrer">{r.sample}</a> : r.sample}</td>
                {COLUMNS.slice(1).map((c) => <td key={c}>{r[c] ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pager" aria-label="Table pages">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </nav>
      )}
    </>
  );
}
```
`dashboard/src/components/FilterBar.tsx`:
```tsx
import type { Filters, ListFilter } from "../data/filters";
import { EMPTY_FILTERS } from "../data/filters";
import type { OptionRow } from "../data/queries";

const LABELS: Record<ListFilter, string> = { countries: "Country", sources: "Isolation source", sts: "Sequence type" };

export function FilterBar({ filters, onChange, optionRows, years }: {
  filters: Filters;
  onChange: (f: Filters) => void;
  optionRows: Partial<Record<ListFilter, OptionRow[]>>;
  years: { min: number | null; max: number | null };
}) {
  const toggle = (key: ListFilter, value: string) => {
    const current = filters[key];
    onChange({ ...filters, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  };
  return (
    <aside className="filters" aria-label="Filters">
      {(Object.keys(LABELS) as ListFilter[]).map((key) => (
        <fieldset key={key}>
          <legend>{LABELS[key]}</legend>
          <div className="options">
            {(optionRows[key] ?? []).map((o) => (
              <label key={o.value}>
                <input type="checkbox" checked={filters[key].includes(o.value)} onChange={() => toggle(key, o.value)} />
                {o.value} ({o.isolates})
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {years.min !== null && years.max !== null && (
        <fieldset>
          <legend>Collection year</legend>
          <label>From <input type="number" min={years.min} max={years.max} value={filters.yearMin ?? ""} placeholder={String(years.min)}
            onChange={(e) => onChange({ ...filters, yearMin: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>To <input type="number" min={years.min} max={years.max} value={filters.yearMax ?? ""} placeholder={String(years.max)}
            onChange={(e) => onChange({ ...filters, yearMax: e.target.value ? Number(e.target.value) : null })} /></label>
        </fieldset>
      )}
      <label><input type="checkbox" checked={filters.carbapenemaseOnly} onChange={(e) => onChange({ ...filters, carbapenemaseOnly: e.target.checked })} /> Carbapenemase carriers only</label>
      <label><input type="checkbox" checked={filters.hideQcWarnings} onChange={(e) => onChange({ ...filters, hideQcWarnings: e.target.checked })} /> Hide QC warnings</label>
      <button onClick={() => onChange(EMPTY_FILTERS)}>Clear filters</button>
    </aside>
  );
}
```
`dashboard/src/components/Footer.tsx`:
```tsx
import type { Manifest } from "../data/manifest";

export function Footer({ manifest, tag, isolates }: { manifest: Manifest; tag: string; isolates: number }) {
  const total = manifest.tables.samples?.rows ?? isolates;
  return (
    <footer>
      <p>Public data; demonstrates a method, not surveillance findings.</p>
      <p>
        Dataset {tag || "unknown"} · built {manifest.created_at.slice(0, 10)} · {total} isolates · schema {manifest.schema_version} ·{" "}
        <a href="https://github.com/simomounir/amr-cloud-pipeline">source code</a>
      </p>
    </footer>
  );
}
```
`dashboard/src/App.tsx`:
```tsx
import { useEffect, useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { Footer } from "./components/Footer";
import { Headline } from "./components/Headline";
import { Heatmap } from "./components/Heatmap";
import { IsolateTable } from "./components/IsolateTable";
import { Panel } from "./components/Panel";
import { Timeline } from "./components/Timeline";
import type { Connection } from "./data/connection";
import { openDashboardDb } from "./data/db";
import { EMPTY_FILTERS } from "./data/filters";
import type { Manifest } from "./data/manifest";
import { useDashboard } from "./useDashboard";

const DATA_URL = new URL("data/", document.baseURI).href;

export function App() {
  const [db, setDb] = useState<{ conn: Connection; manifest: Manifest; tag: string }>();
  const [fatal, setFatal] = useState<string>();
  useEffect(() => {
    openDashboardDb(DATA_URL).then(setDb, (e: Error) => setFatal(e.message));
  }, []);
  const { filters, setFilters, data, years } = useDashboard(db?.conn);
  const clear = () => setFilters(EMPTY_FILTERS);
  const empty = data?.headline.data?.isolates === 0;

  return (
    <div className="app">
      <header>
        <h1>AMR Explorer</h1>
        <p>Antimicrobial resistance in public <em>Klebsiella pneumoniae</em> genomes, queried in your browser.</p>
      </header>
      {fatal ? (
        <p className="fatal" role="alert">{fatal}</p>
      ) : !db || !data ? (
        <div className="skeleton" aria-busy="true">Loading dataset…</div>
      ) : (
        <div className="layout">
          <FilterBar filters={filters} onChange={setFilters} years={years}
            optionRows={{ countries: data.countries.data, sources: data.sources.data, sts: data.sts.data }} />
          <main>
            <Panel title="Overview" error={data.headline.error}>
              {data.headline.data && <Headline data={data.headline.data} />}
            </Panel>
            <Panel title="Resistance over time" error={data.timeline.error} empty={empty} onClear={clear}>
              {data.timeline.data && <Timeline rows={data.timeline.data} />}
            </Panel>
            <Panel title="Most common AMR elements" error={data.heatmap.error} empty={empty} onClear={clear}>
              {data.heatmap.data && <Heatmap rows={data.heatmap.data} />}
            </Panel>
            <Panel title="Isolates" error={data.isolates.error} empty={empty} onClear={clear}>
              {data.isolates.data && <IsolateTable rows={data.isolates.data} />}
            </Panel>
          </main>
        </div>
      )}
      {db && <Footer manifest={db.manifest} tag={db.tag} isolates={data?.headline.data?.isolates ?? 0} />}
    </div>
  );
}
```
`dashboard/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```
`dashboard/src/styles.css`:
```css
:root {
  --ink: #1f2933; --muted: #5f6b7a; --line: #d9dee5; --panel: #ffffff; --bg: #f5f7fa; --accent: #0072b2;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg);
}
body { margin: 0; }
.app { max-width: 1280px; margin: 0 auto; padding: 24px 16px; }
header h1 { margin: 0 0 4px; font-size: 1.6rem; }
header p { margin: 0 0 20px; color: var(--muted); }
.layout { display: grid; grid-template-columns: 260px 1fr; gap: 20px; align-items: start; }
.filters { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: grid; gap: 12px; position: sticky; top: 12px; }
.filters fieldset { border: 0; padding: 0; margin: 0; }
.filters legend { font-weight: 600; margin-bottom: 4px; }
.filters .options { max-height: 160px; overflow-y: auto; display: grid; gap: 2px; }
.filters label { font-size: 0.9rem; }
.filters input[type="number"] { width: 5.5em; margin: 0 6px; }
main { display: grid; gap: 20px; min-width: 0; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; min-width: 0; }
.panel h2 { margin: 0 0 12px; font-size: 1.1rem; }
.panel-error { color: #a61b1b; }
.panel-empty { color: var(--muted); }
.headline { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 0; }
.headline dt { color: var(--muted); font-size: 0.85rem; }
.headline dd { margin: 0; font-size: 1.6rem; font-weight: 600; }
.headline dd.note { font-size: 0.8rem; font-weight: 400; color: var(--muted); }
.table-actions { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
.table-scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th button { all: unset; cursor: pointer; font-weight: 600; text-transform: capitalize; }
th button:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pager { display: flex; gap: 12px; align-items: center; margin-top: 8px; }
footer { margin-top: 24px; color: var(--muted); font-size: 0.85rem; }
.fatal { background: #fdecea; border: 1px solid #f5c2c0; padding: 16px; border-radius: 8px; }
.skeleton { padding: 40px; text-align: center; color: var(--muted); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .filters { position: static; }
}
```

- [ ] **Step 5: Run all checks**

```bash
cd dashboard && npm run lint && npm run typecheck && npx vitest run && npm run e2e
```
Expected: lint and typecheck clean; Vitest all pass; Playwright `1 passed`. If DuckDB-WASM's `row.toJSON()` returns BigInt for any column, add the missing cast in the SQL file, not in TypeScript.

- [ ] **Step 6: Commit**
```bash
git add dashboard
git commit -m "feat(dashboard): React UI over DuckDB-WASM with Playwright smoke test"
```

---

### Task 8: CI, Pages deploy and README

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`, `dashboard/README.md`
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: dashboard scripts (`lint`, `typecheck`, `test`, `e2e`, `build`), Release tags `dataset-*`

- [ ] **Step 1: `dashboard` job in `ci.yml`** (after `stub`):

```yaml
  dashboard:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: dashboard
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@<SHA> # v<latest>
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: dashboard/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
```
Resolve `actions/setup-node`, `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages` latest tags and SHAs with `gh api repos/<repo>/releases/latest -q .tag_name` and `gh api repos/<repo>/commits/<tag> -q .sha`.

- [ ] **Step 2: `.github/workflows/pages.yml`**

```yaml
name: Pages

on:
  push:
    branches: [main]
    paths: ["dashboard/**", ".github/workflows/pages.yml"]
  release:
    types: [published]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    if: github.event_name != 'release' || startsWith(github.event.release.tag_name, 'dataset-')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@<SHA> # v<latest>
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: dashboard/package-lock.json
      - name: Download latest dataset release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          tag=$(gh release list --limit 100 --json tagName,createdAt -q '[.[] | select(.tagName | startswith("dataset-"))] | sort_by(.createdAt) | last | .tagName')
          if [ -z "$tag" ] || [ "$tag" = "null" ]; then echo "::error::No dataset-* release found"; exit 1; fi
          mkdir -p dashboard/public/data
          gh release download "$tag" --dir dashboard/public/data --pattern '*.parquet' --pattern manifest.json
          echo "$tag" > dashboard/public/data/TAG
      - name: Build
        working-directory: dashboard
        run: npm ci && npm run build
      - uses: actions/configure-pages@<SHA> # v<latest>
      - uses: actions/upload-pages-artifact@<SHA> # v<latest>
        with:
          path: dashboard/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@<SHA> # v<latest>
```

- [ ] **Step 3: README** — add near the top of `README.md`:
```markdown
**Live dashboard:** https://simomounir.github.io/amr-cloud-pipeline/ (public data; demonstrates a method)
```
and a "Dashboard" section: what it shows, that it runs entirely in the browser (DuckDB-WASM over the latest `dataset-*` Release), and how to run locally (`cd dashboard && npm ci && npm run preview:fixture`). Replace `dashboard/README.md` with the dev commands (`dev`, `test`, `e2e`, `preview:fixture`) and the data contract (`public/data/{samples,amr_genes,run_summary}.parquet`, `manifest.json`, `TAG`).

- [ ] **Step 4: Validate and commit**
```bash
.venv/bin/python -c "import yaml; [yaml.safe_load(open(f)) for f in ('.github/workflows/ci.yml', '.github/workflows/pages.yml', '.github/workflows/seed-dataset.yml')]"
.venv/bin/pre-commit run --all-files
git add .github/workflows README.md dashboard/README.md
git commit -m "ci: dashboard checks and GitHub Pages deploy; document the dashboard"
```

- [ ] **Step 5: Hand-off steps that need the user** (ask before each)
1. Push `phase3-dashboard`, open the PR, merge after green CI (publishes `amrtools:0.3.0`).
2. Run `gh workflow run "Seed dataset"` on `main`; wait (~2 h); review the artifact.
3. `scripts/publish-dataset.sh <run-id>` (needs `.venv/bin` on PATH for `amrtools`).
4. Enable Pages once: repo Settings → Pages → Source "GitHub Actions" (or `gh api -X POST repos/simomounir/amr-cloud-pipeline/pages -f build_type=workflow`).
5. Publishing the Release triggers `pages.yml`; check the live URL.
