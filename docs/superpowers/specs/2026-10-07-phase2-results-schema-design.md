# Phase 2: Versioned Results Schema, Metadata and Parquet Dataset — Design

Date: 2026-10-07
Status: Draft for review
Builds on: `docs/superpowers/specs/2026-10-06-phase1-isolate-pipeline-design.md`
Source brief: `docs/amr-cloud-pipeline-project.md` (sections 4, 6, 7)

## 1. Scope

Turn pipeline results into a versioned, validated Parquet dataset that a static
dashboard can query in the browser, and attach cleaned sample metadata (when,
where, from what source) fetched from ENA.

**In scope:**
- `amrtools fetch-samples`: build a samplesheet with raw metadata from ENA accessions.
- Metadata cleaning (dates, countries, isolation sources, host).
- Schema v1.0.0 for three tables, defined once in code and exported as JSON.
- Pipeline step `AMRTOOLS_EXPORT`: writes and validates per-run Parquet.
- `amrtools build-dataset`: merges runs into one validated `dataset/` folder.
- `amrtools validate`.
- Tests and CI changes.

**Out of scope:** where the dataset is stored online (Phase 3/4), the dashboard
(Phase 3), AWS (Phase 4). Nothing in Phase 2 uploads data anywhere; CI keeps its
outputs as run artifacts.

**Cost:** $0.

## 2. Decisions

| Topic | Decision | Reason |
|---|---|---|
| Metadata source | `fetch-samples` queries ENA before the run and writes it into the samplesheet | Pipeline stays offline-capable and reproducible; Phase 4 needs accession → samplesheet anyway |
| Accession types | run, sample and study accessions | One ENA call expands a study to its runs |
| Combining runs | each run writes Parquet; `build-dataset` merges | Dashboard reads one dataset; Parquet cannot be appended safely |
| Duplicate samples across runs | newest `run_started_at` wins, in all tables | Reruns replace old results consistently |
| Schema definition | Arrow schemas in `amrtools/schema.py`, exported to `schemas/v1.0.0/*.json` | One source of truth for writer, validator, tests and dashboard |
| New dependencies | `pyarrow`, `pycountry` | Parquet I/O; ISO country names. HTTP uses the standard library |

## 3. Schema v1.0.0

All tables carry `schema_version` in Parquet key-value metadata. Types are Arrow
types; "null" means the column is nullable.

### `samples` (one row per sample, new)

| Column | Type | Null | Notes |
|---|---|---|---|
| `sample` | string | no | primary key |
| `sample_type` | string | no | `isolate` |
| `organism` | string | no | e.g. `Klebsiella_pneumoniae` |
| `run_accession` | string | yes | ENA, null for local samples |
| `sample_accession` | string | yes | |
| `study_accession` | string | yes | |
| `collection_date_raw` | string | yes | original text |
| `collection_year` | int16 | yes | |
| `collection_month` | int8 | yes | 1–12 |
| `collection_date_precision` | string | no | `day`, `month`, `year`, `missing` |
| `country` | string | yes | ISO 3166 short name, e.g. `United States` |
| `region` | string | yes | text after the colon, trimmed |
| `country_raw` | string | yes | original text |
| `isolation_source_raw` | string | yes | original text |
| `source_category` | string | no | `blood`, `urine`, `respiratory`, `screening`, `wound`, `other_clinical`, `environmental`, `unknown` |
| `host` | string | yes | trimmed, null when missing |
| `run_id` | string | no | |
| `run_started_at` | timestamp[us, UTC] | no | |

### `amr_genes` (one row per detected element)

Phase 1 columns with types: `sample, sample_type, organism, gene_symbol,
element_name, element_type, element_subtype, drug_class, drug_subclass, method,
contig_id, amrfinder_version, amrfinder_db_version` (string), `pct_identity`,
`pct_coverage` (float64), plus `run_id` (string), `run_started_at`
(timestamp[us, UTC]). Only `drug_class`, `drug_subclass` and `contig_id` are
nullable.

### `run_summary` (one row per sample)

Phase 1 columns with types: `sample, sample_type, organism, kleborate_species,
st, qc_status, qc_reasons` (string), `resistance_score`, `virulence_score`
(int8, null when Kleborate gave no result), `reads_after_qc`, `assembly_length`,
`n50` (int64), `n_contigs`, `n_amr_genes` (int32), `q30_rate` (float64), plus
`run_id`, `run_started_at`. `qc_status` is `pass` or `warn`; `qc_reasons` is an
empty string when passing.

### Versioning rules

- Adding a column: minor bump (1.1.0). Renaming, removing or retyping: major bump (2.0.0).
- `build-dataset` refuses to combine tables with different major versions.
- `schemas/v1.0.0/{samples,amr_genes,run_summary}.json` list each column as
  `{name, type, nullable, description}`, generated from `schema.py` by
  `amrtools schema --export schemas/`. A test fails if the committed JSON differs
  from what `schema.py` generates.

## 4. `amrtools fetch-samples`

```bash
amrtools fetch-samples PRJNA376414 SRR5386028 --organism Klebsiella_pneumoniae --out samplesheet.csv
amrtools fetch-samples --accession-file ids.txt --organism Klebsiella_pneumoniae --out samplesheet.csv
```

- Calls the ENA Portal API `filereport` (`result=read_run`) once per accession with
  fields `run_accession, sample_accession, study_accession, instrument_platform,
  library_layout, fastq_ftp, collection_date, country, isolation_source, host`.
- Keeps runs with `instrument_platform=ILLUMINA`, `library_layout=PAIRED` and exactly
  one `_1.fastq.gz` and one `_2.fastq.gz`. Every other run goes to `<out>.skipped.csv`
  with `run_accession, reason`.
- Duplicate runs (same run reached through a study and directly) appear once.
- Output columns: `sample` (= run accession), `fastq_1`, `fastq_2` (https URLs),
  `sample_type` (`isolate`), `organism`, then `run_accession, sample_accession,
  study_accession, collection_date, country, isolation_source, host` with raw
  ENA text.
- HTTP: standard library, 5 attempts with exponential backoff on network errors and
  HTTP 5xx; HTTP 4xx (bad accession) fails immediately naming the accession.
- An accession that returns zero runs is an error naming it.

## 5. Metadata cleaning (`amrtools/metadata.py`)

Pure functions, each with table-driven tests using real ENA values.

**Missing tokens** (case-insensitive, after trimming): empty, `not provided`,
`not collected`, `missing`, `unknown`, `not applicable`, `na`, `n/a`, `none`,
`restricted access`.

**`clean_date(raw) -> (year, month, precision)`**: accepts `YYYY`, `YYYY-MM`,
`YYYY-MM-DD`, and ISO datetimes (date part used). A year outside 1900–2100, an
invalid month or anything else gives `missing`. Ranges such as `2017/2018` give
`missing`.

**`clean_country(raw) -> (country, region)`**: split on the first `:`, trim both
parts. The country part maps through an alias table (`USA`, `UK`, `Viet Nam`,
`Russia`, `South Korea`, `Iran`, `Czech Republic`, `Turkey`, …) then `pycountry`
lookup by name, common name, official name or alpha-2/alpha-3 code. Unrecognised
gives `country = null`; `region` is kept when present.

**`categorize_source(raw) -> category`**: lower-cased, first matching rule wins:

| Category | Keywords |
|---|---|
| blood | blood, bacteremia, bacteraemia, sepsis, septicemia |
| urine | urine, urinary, uti |
| respiratory | sputum, bronch, bal, tracheal, respiratory, pneumonia, lung, throat, nasal |
| screening | rectal, stool, feces, faeces, fecal, faecal, perianal, perirectal, gut, colonization, colonisation, screening |
| wound | wound, pus, abscess, skin, tissue, ulcer |
| environmental | water, wastewater, sewage, soil, environment, sink, drain, surface |
| other_clinical | clinical, hospital, patient, catheter, cerebrospinal, csf, swab, aspirate, fluid, human |
| unknown | missing tokens or no match |

Keywords match whole words (`\b…\b`), except `bronch` which matches as a prefix.

**`clean_host(raw)`**: trimmed text, null when a missing token.

## 6. Pipeline changes

- `assets/schema_input.json`: add optional columns `run_accession,
  sample_accession, study_accession, collection_date, country, isolation_source,
  host` (strings). Existing samplesheets keep working.
- `main.nf`: passes `params.input` (the samplesheet) to the workflow.
- New process `AMRTOOLS_EXPORT` (amrtools container) after `AMRTOOLS_MERGE`:

  ```
  amrtools export --samplesheet <csv> --genes amr_genes.tsv --summary run_summary.tsv \
      --run-id <workflow.sessionId> --run-started-at <workflow.start ISO-8601> --outdir parquet
  ```

  It builds `samples` from the samplesheet (cleaning metadata), types the two TSVs,
  writes three zstd Parquet files and runs `validate` on them before exiting. It has
  no stub block, so stub runs exercise it for real.
- Output: `${outdir}/parquet/{samples,amr_genes,run_summary}.parquet`, plus a
  human-readable `${outdir}/summary/samples.tsv` next to the two existing TSVs.
- `tests/data/samplesheet_test.csv` gains the metadata columns for the three test
  runs, copied from `fetch-samples` output (FASTQ URLs stay on the Release).

## 7. `amrtools build-dataset`

```bash
amrtools build-dataset results/run1/parquet results/run2/parquet --out dataset/
```

1. Validate each input folder; refuse mixed schema major versions.
2. For each sample, keep the rows of the run with the newest `run_started_at` in all
   three tables.
3. Write the three tables (zstd) and `manifest.json` into a temporary folder next to
   `--out`: `schema_version`, `created_at`, `runs` (`run_id`, `run_started_at`,
   sample count), per-table row counts, per-file sha256.
4. Validate the temporary folder, including checksums.
5. Fail if any file exceeds 95 MB.
6. Replace `--out` with the temporary folder only after steps 4–5 pass.

## 8. `amrtools validate <dir>`

Checks, each failing with the file, column and first offending value:

- Every expected file present; columns, Arrow types and nullability match `schema.py`.
- `schema_version` metadata present; the major version is the supported one.
- `samples.sample` unique; `run_summary.sample` unique; every `amr_genes.sample` and
  `run_summary.sample` exists in `samples`.
- `source_category`, `collection_date_precision`, `qc_status` within allowed values.
- When `manifest.json` exists: row counts and sha256 match the files.

## 9. Error handling

- All amrtools commands exit 1 with `amrtools: error: <message>` for bad input,
  failed validation or ENA errors (existing CLI contract).
- `build-dataset` never leaves a partial `--out`: on any failure the previous
  dataset (if any) is untouched and the temporary folder is removed.

## 10. Testing

**pytest:**
- Cleaning: table-driven tests of dates, countries, sources and hosts, including the
  values seen in 2,000 real ENA runs (`2018`, `not provided`, `USA: Houston`,
  `Germany:Bavaria`, `rectal swab`, `clinical material`, `lisbon`, `Pus`).
- `fetch-samples` against recorded ENA responses (fixtures saved from the real API):
  a run, a study with several runs, a non-Illumina run (skipped), a single-end run
  (skipped), a 5xx then success (retry), a 4xx (error), zero results (error), and a
  run requested twice (deduplicated).
- Schema: JSON export matches committed files.
- Export: TSV + samplesheet → Parquet round-trip with correct types; samplesheet
  without metadata columns works; stub tables (`NA` values) become nulls.
- `build-dataset`: dedup by newest run; mixed major versions refused; failure leaves
  previous dataset intact; manifest correct.
- `validate`: wrong type, missing column, duplicate key, orphan gene row, bad
  category, checksum mismatch, missing version.

**nf-test:**
- Stub test also asserts the three Parquet files exist (export validates them).
- Full test also asserts, via `summary/samples.tsv`, that SRR5386028 is
  United States / Houston / 2014 / urine.

**CI:** the full job runs `amrtools build-dataset` on its output and uploads
`dataset/` with the TSV tables as the `tiny-dataset-results` artifact. ENA is never
called in CI.

## 11. Done criteria

- All CI jobs green on main.
- `nextflow run . -profile test,docker` writes three valid Parquet files.
- `build-dataset` over that output produces a valid `dataset/` with `manifest.json`.
- `fetch-samples` on the three test accessions reproduces their metadata columns.
- README documents fetch → run → build-dataset, and the schema.

## 12. Amendments made during planning

- `country` uses pycountry's `common_name` when present, else `name`
  (`Vietnam`, `South Korea`, `Iran`), which reads better on a dashboard than strict
  ISO short names (`Viet Nam`, `Korea, Republic of`).
- `run_summary.kleborate_species` and `st` are nullable (`NA` from Phase 1 becomes
  null), like the scores.
- `amrtools stub` writes typed placeholders (zeros, `qc_status=warn`,
  `qc_reasons=stub`) so stub runs export valid Parquet.
- amrtools and the pipeline move to version 0.2.0, because published image tags are
  immutable.
- `build-dataset` refuses to replace an existing `--out` folder that has no
  `manifest.json`, so a typo cannot delete an unrelated folder.
