# Phase 4c: Pipeline on AWS Batch — Design and Plan

Date: 2026-10-08. Approved in conversation. Builds on Phase 4b (`infra/platform` up,
`infra/compute` apply → run → destroy). Compact spec + plan in one file.

## Goal
Run the 3 test isolates on AWS Batch spot, get the same biology as local/CI (ST13/KPC,
ST147/NDM, ST23/none), and record a measured cost per genome. Compute destroyed afterwards.

## Design
1. **`awsbatch` profile** (`conf/awsbatch.config`, included from `nextflow.config`):
   `process.executor = 'awsbatch'`, `process.queue = 'amr-queue'`, `aws.region = 'eu-west-1'`,
   `aws.batch.cliPath = '/opt/aws-cli/bin/aws'`, `aws.batch.volumes = '/opt/aws-cli'`,
   `aws.batch.logsGroup = '/amr/batch'`, `aws.batch.maxSpotAttempts = 3`,
   `process.resourceLabels = [Study: params.study, Run: params.run_id]`, Docker settings off
   (Batch runs the containers). New params `study` (default `adhoc`) and `run_id`.
2. **Credentials:** `infra/scripts/run-on-batch.sh` assumes `amr-pipeline-runner` (12 h) and
   passes temporary keys to Nextflow via environment variables (works regardless of SDK support
   for `aws login`; same path as GitHub OIDC in 4d).
3. **Run script** `infra/scripts/run-on-batch.sh --study <name> --input <csv> [--profile <extra>]`:
   apply compute → upload AMRFinderPlus DB once to `s3://<bucket>/refs/` if missing → Nextflow
   (head on the laptop under `caffeinate`, workDir `s3://<bucket>/work/<study>/<run>/`, outdir
   `s3://<bucket>/results/<study>/<run>/`, trace + report) → copy results locally → `amrtools
   validate` → cost report → destroy compute (trap, always).
4. **Cost report** `infra/scripts/cost_report.py`: before destroy, list the run's EC2 instances
   (tag `Project`, launch and termination times, type, AZ), price each with the spot price
   history for that window, and divide by the number of samples. Cross-check in Cost Explorer
   the next day.
5. **Runner permissions:** add only what the first run shows Nextflow needs; never wildcards.

## Plan
1. Profile + params; render check (`nextflow config -profile awsbatch,test`) in CI stub job.
2. Cost report script with a unit test on recorded EC2/price JSON.
3. Run script (trap destroy, DB upload, results copy, validate, cost).
4. Live run on the test samplesheet (user approved the design incl. this run); compare biology
   with the local full test; record time and cost in README.
5. Review, PR, merge with the user's OK.
