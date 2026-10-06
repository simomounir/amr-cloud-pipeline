# Phase 1: Isolate AMR Pipeline (Local Foundations) — Design

Date: 2026-10-06
Status: Approved 2026-10-06; amended during planning (section 13)
Source brief: `docs/amr-cloud-pipeline-project.md` (sections 5, 6, 7, 9)

## 1. Scope

Build a Nextflow DSL2 pipeline that takes Illumina paired-end reads from
*Klebsiella pneumoniae* isolates and produces per-sample AMR calls, typing and
QC metrics, runs locally in Docker, and is tested in GitHub Actions.

**In scope:** repo skeleton, tiny test dataset, pipeline (QC, assembly, AMR
calling, species/typing, summary), `amrtools` Python package and container,
unit and pipeline tests, CI, pre-commit secret scanning, README.

**Out of scope (later phases):** Parquet output and schema versioning (Phase 2),
dashboard (Phase 3), AWS / Terraform / Batch (Phase 4), long-read or hybrid
assembly, metagenomes (Phase 6).

**Cost:** $0. No AWS resources are created in Phase 1.

## 2. Decisions

| Topic | Decision | Reason |
|---|---|---|
| Organism | *K. pneumoniae* | WHO-priority pathogen, rich AMR gene content, moderate genome (~5.5 Mb) |
| Read type | Illumina paired-end only | Most public data; assembly module kept swappable for long reads later |
| Orchestrator | Nextflow DSL2, nf-core conventions | Same code runs locally, in CI and on AWS Batch |
| Standard tools | nf-core modules: fastp, shovill, amrfinderplus/update, amrfinderplus/run; local module for Kleborate v3 | Pinned BioContainers images, recognised conventions |
| Species / typing | Kleborate v3.2.4 (local module) | Klebsiella-specific: species, ST, resistance and virulence scores |
| Own code | `amrtools` Python package, own Dockerfile | Unit-testable parsing layer; home for Phase 2 Parquet step |
| Container registry | GitHub Container Registry (public) | Free; AWS Batch can pull it later without ECR |
| Reference platform | linux/amd64 | CI and AWS Batch are amd64; the M1 Mac is a dev machine under emulation |

## 3. Repo layout

The current directory (`AMR/`) is the repo root.

```
main.nf                       # entry point, calls workflows/isolate.nf
nextflow.config               # params, profiles: docker, test (awsbatch in Phase 4)
nextflow_schema.json          # pipeline params schema
assets/schema_input.json      # samplesheet schema (nf-schema plugin)
modules.json                  # pinned nf-core module versions
conf/
  base.config                 # resources per process label, retry policy
  test.config                 # tiny dataset, low resources
workflows/isolate.nf
modules/
  nf-core/                    # installed with `nf-core modules install`
  local/kleborate/main.nf     # Kleborate v3 (nf-core module is still v2)
  local/amrtools/sample/main.nf
  local/amrtools/merge/main.nf
containers/amrtools/Dockerfile
src/amrtools/
  parsers/{amrfinder,kleborate,fastp,assembly}.py
  summarise.py
  cli.py
pyproject.toml
tests/
  python/                     # pytest + fixtures/
  nf-test/                    # stub and full pipeline tests
  data/samplesheet_test.csv   # points at GitHub Release URLs
schemas/  infra/  dashboard/  # README stubs only (later phases)
docs/
.github/workflows/ci.yml
.pre-commit-config.yaml       # gitleaks, ruff
.gitignore                    # work/, results/, .nextflow*, *.fastq.gz, .env, AWS creds
```

## 4. Data flow

```
samplesheet.csv  (validated by nf-schema)
  -> FASTP                 trimmed reads + QC JSON
  -> SHOVILL               contigs.fa
  -> AMRFINDERPLUS_RUN     --organism Klebsiella_pneumoniae (enables point mutations)
     KLEBORATE             (runs in parallel with AMRFinderPlus)
  -> AMRTOOLS_SAMPLE       per sample: <sample>.amr_genes.tsv, <sample>.run_summary.tsv
  -> collect all samples
  -> AMRTOOLS_MERGE        amr_genes.tsv, run_summary.tsv
```

**Samplesheet columns:** `sample, fastq_1, fastq_2, sample_type, organism`.
`sample_type` is `isolate` in Phase 1. These fields are present so metagenome
samples can share the same results tables later.

**Reference database:** `params.amrfinder_db` (path). If empty, the
`AMRFINDERPLUS_UPDATE` process downloads it. The database version is recorded in
every output row.

## 5. `amrtools`

**CLI:**
- `amrtools sample --sample ... --fastp-json ... --contigs ... --amrfinder ... --kleborate ... [QC options]` builds one sample's two tables.
- `amrtools merge --genes ... --summaries ... --outdir ...` concatenates per-sample tables, sorted by sample.
- `amrtools stub ...` writes placeholder tables for `-stub` runs.

**Parsers** turn each tool's native output into rows with our own column names.
Each parser checks that required columns exist and raises an error naming the
file and the missing column. The AMRFinderPlus parser accepts both v3 headers
(`Gene symbol`, `Sequence name`) and v4 headers (`Element symbol`,
`Element name`). Assembly statistics (total length, contig count, N50) are
computed in Python from `contigs.fa`.

**Output 1: `amr_genes.tsv`** (one row per detected element)

`sample, sample_type, organism, gene_symbol, element_name, element_type,
element_subtype, drug_class, drug_subclass, method, pct_identity, pct_coverage,
contig_id, amrfinder_version, amrfinder_db_version`

**Output 2: `run_summary.tsv`** (one row per sample)

`sample, sample_type, organism, kleborate_species, st, resistance_score,
virulence_score, reads_after_qc, q30_rate, assembly_length, n_contigs, n50,
n_amr_genes, qc_status, qc_reasons`

**QC flags:** `qc_status` is `pass` or `warn`; samples are never dropped.
`qc_reasons` lists every failed check, separated by `;`. Defaults, configurable
through pipeline params:

| Check | Default |
|---|---|
| Assembly length | 5.0–6.5 Mb |
| Contig count | < 500 |
| Q30 rate after QC | > 0.80 |
| Kleborate species | equals `organism` with `_` replaced by a space |

A sample with zero AMR hits has no rows in `amr_genes.tsv` and `n_amr_genes = 0`.
`n_amr_genes` counts rows with `element_type == AMR` (acquired genes and point
mutations). AMRFinderPlus runs with `--plus`, so STRESS and VIRULENCE rows also
appear in `amr_genes.tsv` but are not counted.

If Kleborate produces no output (assembly outside the K. pneumoniae complex),
species, ST and scores are `NA` and the sample gets `species_mismatch`.

These column names become results schema v0.1 in Phase 2.

**Dependencies:** pandas. Packaged with `pyproject.toml`; the Dockerfile installs
the package on a slim Python base image.

## 6. Error handling

- **Samplesheet:** validated by nf-schema before any process runs.
- **Out of memory** (exit status 137 or 140): retry up to 2 times, scaling memory
  with the attempt number.
- **Any other failure:** `terminate`. Phase 4 changes this to finish remaining
  samples and report failures in the run summary.
- **Malformed tool output:** `amrtools` fails with a message naming file and column.

## 7. Test dataset

Three *K. pneumoniae* Illumina paired-end runs from SRA/ENA, selected to meet all
of the following:

- at least one carries a carbapenemase (e.g. *bla*KPC or *bla*NDM)
- the three samples have different sequence types
- species and ST are documented in the source study or in Pathogenwatch
- average read length of 75 bp or more

Reads are subsampled to about 20x coverage with seqtk using a fixed seed, and
uploaded as assets of a GitHub Release named `test-data-v1`. They are never
committed to git. `tests/data/samplesheet_test.csv` points at the Release URLs.
The accessions, their expected species, ST and key genes, and the subsampling
command are recorded in `tests/data/README.md`. Choosing the accessions is the
first task of the implementation plan.

Selected (expected values from Kleborate's own test outputs):

| Run | Platform | Expected ST | Carbapenemase |
|---|---|---|---|
| SRR5386028 | NextSeq 500 | ST13 | KPC-2 |
| ERR14097885 | MiSeq | ST147 | NDM-5 |
| SRR33580217 | NextSeq 2000 | ST23 (hypervirulent) | none |

## 8. Testing

1. **pytest** (`tests/python/`)
   - each parser against trimmed real-output fixtures, including both
     AMRFinderPlus header versions
   - N50 and length on a synthetic FASTA with known answers
   - QC flag logic at threshold edges
   - zero-hit sample
   - missing-column error message
2. **nf-test stub test**: whole workflow with `-stub`, using tiny committed fake
   FASTQs (no download); asserts both output tables exist and the summary has one
   row per sample.
3. **nf-test full test** on the tiny dataset. Asserts biological facts, not file
   snapshots: every sample's `kleborate_species` is *K. pneumoniae*, each sample's
   ST matches the expected value, and the carbapenemase carrier has its gene in
   `amr_genes.tsv`.

## 9. CI (`.github/workflows/ci.yml`)

| Job | Trigger | Steps |
|---|---|---|
| lint | push, PR | pre-commit (ruff, gitleaks) |
| unit | push, PR | pytest |
| stub | push, PR | build amrtools image locally, nf-test stub test |
| full | push to main, manual | build image, restore cached AMRFinderPlus DB, nf-test full test, upload results as artifact |

On push to main, the amrtools image is also pushed to
`ghcr.io/<owner>/amrtools:<version>` and `:latest`.

## 10. Local development notes

- Docker profile sets `--platform linux/amd64`. On the Apple M1 dev machine this
  runs under emulation; a full local run is slow. Day-to-day local checks are
  pytest and the stub test. CI is the reference environment.
- Update Docker Desktop (currently 20.10) before starting.
- Install Nextflow, nf-core tools and nf-test (none installed yet).

## 11. Done criteria

- All four CI jobs pass on main.
- `nextflow run . -profile test,docker` produces `amr_genes.tsv` and
  `run_summary.tsv` locally and in CI.
- README covers purpose, architecture sketch, how to run, test dataset, and the
  framing caveat (public data demonstrates a method, not new findings).

## 12. Verified during planning

- nf-core `kleborate` module pins v2.1.0, so Kleborate v3.2.4 runs in a local module.
- Kleborate v3 with `--trim_headers` writes `species`, `ST`, `resistance_score`,
  `virulence_score` to `<outdir>/klebsiella_pneumo_complex_output.txt`.
- AMRFinderPlus 4.2.7 headers: `Element symbol`, `Element name`, `Type`, `Subtype`,
  `% Coverage of reference`, `% Identity to reference`.

## 13. Amendments made during planning

- `amrtools` runs per sample, then a merge step. Shovill names every assembly
  `contigs.fa`, so one collect step would have staged colliding file names; per-sample
  parsing also parallelises and matches the metagenome plan.
- QC adds a `species_mismatch` check.
- Test reads are subsampled to 20x (15x is marginal for SPAdes) and the read-length
  rule is relaxed to a 75 bp average to keep SRR5386028, whose expected results are
  documented.
- Relative FASTQ paths in a samplesheet resolve against the samplesheet's folder.
- nf-schema pinned to 2.8.0 (3.0.0 is a week old and has breaking API changes).
