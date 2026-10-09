# Phase 4e-prep: Ready for a 150-isolate study — Design and Plan

Date: 2026-10-09. Builds on 4c/4d. Goal: a study of about 150 public isolates runs on GitHub in
one Cloud run, survives a few bad samples, and can be resumed instead of redone.

## Facts this design rests on (measured or read, 2026-10-09)
- Cloud run `test` (3 isolates): about 1 vCPU-hour per genome (Shovill 5–13 min on 4 vCPUs
  dominates), $0.034 per genome.
- 150 isolates ≈ 110–160 vCPU-hours: 3.5–5 h at 32 vCPUs (too close to the 5.5 h limit),
  about 1.5–2 h at 96.
- Spot vCPU quota in eu-west-1 raised from 32 to **96** (AWS approved 2026-10-09).
- `errorStrategy` is `terminate` for anything but out-of-memory: one bad public read set
  stops the whole run.
- Validation already allows a sample with metadata but no results (no orphan check in that
  direction). `build-dataset` already merges several runs (and resumed runs sharing a run_id).
- GitHub runners are ephemeral: Nextflow's local `.nextflow` cache is gone after every run.
  Nextflow's cloud cache (`NXF_CLOUDCACHE_PATH`, nf-cloudcache) keeps it in S3.

## Design
1. **Failed samples don't stop the run.**
   - Per-sample processes (FASTP, SHOVILL, AMRFINDERPLUS_RUN, KLEBORATE, AMRTOOLS_SAMPLE):
     - out-of-memory → retry with more memory (unchanged);
     - any other error → retry once (transient download or host problems), then `ignore`.
   - Run-level steps (database update, AMRTOOLS_MERGE, AMRTOOLS_EXPORT) keep `terminate`.
   - Spot reclaims stay with `aws.batch.maxSpotAttempts`.
2. **Failures are recorded in the dataset.**
   - Schema **v1.2.0** (additive): `samples.analysis_status`, either `complete` (the sample
     has a `run_summary` row) or `failed`.
   - Export derives it, so no new pipeline channel is needed.
   - Validation: `complete` ⇔ a `run_summary` row exists.
   - `build-dataset` reads v1.1.0 inputs by setting `complete` for every sample.
3. **A run with too many failures is not a success.**
   - More than 25% of samples failed (or none completed) → the run script exits non-zero
     and writes no `_SUCCESS` (something systemic, not bad samples).
   - Otherwise it prints `N of M samples failed: <names>` in the log and the GitHub step summary.
4. **Resume.**
   - The Nextflow cache goes to `s3://<bucket>/cache/<study>/<run_id>/` (cloud cache).
   - `run-on-batch.sh --resume <run_id>` reuses that run's id, work dir and cache, and passes
     `-resume`. Finished tasks are reused, and the samplesheet is taken from the original run.
   - Cloud run gets an optional `resume_run_id` input.
   - Platform lifecycle: `cache/` expires after 7 days, the same as `work/`. A run can be
     resumed for a week.
5. **Throughput.** `max_vcpus` default raised from 32 to 96 (equal to the quota). Total cost is
   unchanged; wall time is shorter. Batching a study across several runs is **not** built:
   with 96 vCPUs, 150–250 isolates fit in one run, and `build-dataset` can already merge runs
   if that ever changes.
6. **Dashboard (minimal, the rest waits for v2).** Counts and charts use `complete` samples
   only; the footer shows "N isolates failed analysis" when N > 0.

## Not in this step
Study 1 cohort selection (its own short design next: research and list of accessions),
dashboard v2, moving the Nextflow head off GitHub (only if a study exceeds about 5 h).

## Testing
- nf-test: a sample with broken reads → the run finishes, other samples complete, and the
  broken one is `failed` in `samples.parquet`.
- pytest:
  - export derives `analysis_status`;
  - validation rejects a `complete` without a summary, and a `failed` with one;
  - build-dataset upgrades v1.1.0 inputs;
  - the run script's failure threshold (fake aws/terraform/nextflow);
  - `--resume` reuses the run id, work dir and cache path.
- Terraform plan tests: `max_vcpus` default 96; `cache/` lifecycle rule.
- Dashboard: unit test for the failed count; e2e fixture includes one failed sample.
- Live:
  - Cloud run `test` plus one deliberately broken accession → completes with 1 failed.
  - Cancel a run midway, then resume it → finished tasks are cached, not redone.

## Plan
1. Schema v1.2.0 + export/validate/build-dataset (test-first).
2. errorStrategy per process + nf-test with a broken sample.
3. Run script: failure threshold, `--resume`, cloud cache; Cloud run input `resume_run_id`.
4. Infra: `max_vcpus` 96, `cache/` lifecycle (show plan before apply).
5. Dashboard: complete-only counts + failed note.
6. Live checks above (about $0.20), review, PR (ask before push).
