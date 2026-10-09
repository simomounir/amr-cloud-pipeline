# AMR Cloud Pipeline

[![CI](https://github.com/simomounir/amr-cloud-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/simomounir/amr-cloud-pipeline/actions/workflows/ci.yml)

**Live dashboard:** https://simomounir.github.io/amr-cloud-pipeline/ (public data; demonstrates a method)

Detects antimicrobial-resistance genes in bacterial isolate genomes. A Nextflow
pipeline built to run the same way on a laptop, in CI and on AWS Batch.

> Uses public data. Results demonstrate a method, not new surveillance findings.

## What it does

```
reads (Illumina, paired) → fastp → Shovill → AMRFinderPlus ─┐
                                          └→ Kleborate ─────┴→ amrtools → amr_genes.tsv
                                                                         run_summary.tsv
```

| Output | One row per | Contents |
|---|---|---|
| `summary/amr_genes.tsv` | detected gene or mutation | gene, drug class, identity, coverage, tool and database versions |
| `summary/run_summary.tsv` | sample | species, sequence type, resistance/virulence scores, read and assembly QC, `qc_status` |

Samples failing QC thresholds are flagged `warn` with reasons, never dropped.

## Results format

Each run writes versioned Parquet tables to `results/parquet/`; `build-dataset`
combines runs (per sample, the newest complete result wins; a failed attempt never
replaces an earlier result) into `dataset/` with a `manifest.json`.

| Table | One row per | Highlights |
|---|---|---|
| `samples` | sample | ENA accessions, collection year/month, country, region, isolation source category, host (raw values kept), `analysis_status` (complete or failed) |
| `run_summary` | sample | species, ST, scores, QC |
| `amr_genes` | detected element | gene, drug class, identity, coverage |

The current schema (v1.2.0) is documented in [schemas/v1.2.0](schemas/v1.2.0); older 1.x
folders are still read. Check any folder with `amrtools validate <dir>`.

## Run it

Requirements: Docker, Java 17+, Nextflow ≥ 25.04, Python 3.12 (for `amrtools`).

```bash
pip install .                                   # provides the amrtools command
amrtools fetch-samples PRJNA376414 --organism Klebsiella_pneumoniae --out samples.csv
nextflow run . -profile docker --input samples.csv --outdir results/batch1
amrtools build-dataset results/batch1/parquet --out dataset
```

Give every run its own `--outdir`, and include the existing dataset when adding a batch,
so earlier samples are kept (a sample present in both keeps its newest result):

```bash
nextflow run . -profile docker --input more.csv --outdir results/batch2
amrtools build-dataset dataset results/batch2/parquet --out dataset
```

`fetch-samples` accepts run, sample or study accessions, keeps Illumina paired-end
runs and lists skipped runs in `samples.skipped.csv`. `nextflow run . -profile test,docker`
runs the tiny test dataset.

Samplesheet:

```csv
sample,fastq_1,fastq_2,sample_type,organism
S1,reads/S1_R1.fastq.gz,reads/S1_R2.fastq.gz,isolate,Klebsiella_pneumoniae
```

Relative paths resolve against the samplesheet's folder. `fastq_1`/`fastq_2` may also be
HTTP(S)/FTP URLs (both or neither): each sample's first task downloads them, retrying broken
transfers and checking the size, and the MD5 when the optional `md5_1`/`md5_2` columns give one
(`fetch-samples` fills them from ENA). Pass
`--amrfinder_db <file.tar.gz>` to pin an AMRFinderPlus database; otherwise the
latest is downloaded. Build the archive from one database version:

```bash
amrfinder_update -d amrfinderdb
tar czf amrfinderdb.tar.gz -C "amrfinderdb/$(readlink amrfinderdb/latest)" .
```

On Apple Silicon, containers run as `linux/amd64` under emulation: give Docker
Desktop at least 8 GB of memory and expect slow assemblies.

## Cloud

The same pipeline runs on AWS Batch spot instances, set up with Terraform in [infra/](infra/):
long-lived storage and identity, short-lived compute that is destroyed after every run (about $0
while idle). First measured run: **$0.021 per genome**, identical results to local and CI.
Studies (a question plus a list of ENA accessions, in [studies/](studies/)) run on AWS from the
GitHub Actions page with one click, using OIDC (no stored AWS keys).

## Dashboard

A static site on GitHub Pages ([dashboard/](dashboard/)) that loads the newest
`dataset-*` Release and runs every query in the visitor's browser with DuckDB-WASM:
headline numbers, carbapenemase families over time, the most common AMR elements, and
an isolate table with CSV export. There is no server or database; hosting is free.

Datasets are published with `scripts/publish-dataset.sh` from a workflow artifact; the
first one comes from the `Seed dataset` workflow (30 public isolates processed on
GitHub Actions, see [data/README.md](data/README.md)).

## Tests

| Layer | Command | Runs in CI |
|---|---|---|
| Python unit tests | `pytest` | every push |
| Pipeline wiring (stub) and input validation | `nf-test test tests/ --tag stub,validation --profile test,docker` | every push |
| Full tiny-dataset run | `nf-test test tests/ --tag full --profile test,docker` | push to main |
| Dashboard: lint, types, SQL query tests, browser smoke test | `cd dashboard && npm test && npm run e2e` | every PR and push to main |

Test data: see [tests/data/README.md](tests/data/README.md).

## Roadmap

1. Phase 1: local pipeline, tests, CI
2. Phase 2: versioned Parquet results schema, ENA metadata
3. **Phase 3:** static dashboard (DuckDB-WASM on GitHub Pages)
4. **Phase 4:** AWS Batch with Terraform (4a–4d done: account, infrastructure, first cloud run at $0.021/genome, one-click runs from GitHub)
5. Phase 6: metagenome mode on the same platform

Project brief: [docs/amr-cloud-pipeline-project.md](docs/amr-cloud-pipeline-project.md).
