# Infrastructure (AWS, Terraform)

Everything the pipeline needs on AWS, as code, split by lifetime: long-lived data and
identity, short-lived compute. Between runs only storage costs anything (pennies).

| Root | What | Lifetime |
|---|---|---|
| `bootstrap/` | S3 bucket `amr-tfstate-<account>` holding the other roots' state (versioned, encrypted, private) | created once, never destroyed |
| `platform/` | S3 bucket `amr-pipeline-<account>` with its protections and lifecycle; IAM roles `amr-pipeline-runner`, `amr-compute-deployer`, `amr-batch-instance`, `amr-batch-job`; GitHub OIDC provider | stays up between runs |
| `compute/` | VPC (public subnets, no NAT), AWS Batch spot compute (0–96 vCPU), job queue, log group, smoke job (no IAM) | apply → run → destroy |

Budgets (`zero-spend`, `monthly-cap-25`) live outside Terraform so nothing here can remove them.
Destroying `compute/` never touches the bucket or the runner role, so results stay protected
and GitHub can always assume the runner role to start the next run.

## Design notes

- **Region** `eu-west-1`; every resource tagged `Project=amr-cloud-pipeline`, `ManagedBy=terraform`.
- **No NAT gateway** (it costs ~$30/month even idle). Instances get public IPs to reach ENA
  and container registries; the security group allows no inbound traffic.
- **Batch** is spot only (`SPOT_PRICE_CAPACITY_OPTIMIZED`), x86 families c6i/c6a/c7i/m6i/m6a,
  min 0 vCPU (nothing runs at idle), max `var.max_vcpus` (default 96, the spot quota) as a burn-rate cap.
  Hosts use the ECS Amazon Linux 2023 image with a 100 GB disk and a self-contained AWS CLI
  (Miniforge + conda `awscli`) installed at boot in `/opt/aws-cli`. Nextflow mounts it into every
  task container to stage files; the official AWS CLI build fails in minimal images (no `libz`). Instance metadata is limited to
  the host (hop limit 1), so containers only see their own job role.
- **S3** (platform): `work/<study>/<run>/` expires after 7 days; `results/<study>/<run>/` is
  kept. `prevent_destroy` and `force_destroy = false` keep results from being deleted by accident.
- **IAM** (all in platform, each scoped to this bucket and queue): instance role (ECS only; no
  S3), job role (bucket read/write), `amr-pipeline-runner` (submits jobs, passes only the job
  role, reads/writes the bucket), plus Batch's service-linked role.
- **Deployer** (`amr-compute-deployer`, platform): the identity that applies and destroys
  `compute/`. It can only touch resources tagged `Project=amr-cloud-pipeline`, Batch resources
  named `amr-*` and the `/amr/batch` log group. It has no IAM write permission at all: the
  instance and job roles live in platform, and it may only hand those two to Batch
  (`iam:PassRole`). So a compromised workflow cannot create a role that outlives the run.
  The 96 vCPU cap is a Terraform setting (and the spot quota), not an IAM limit; the budgets are the hard stop.
- **Boot script fails closed**: if installing the AWS CLI fails, the host shuts down and Batch
  replaces it, instead of every job on it failing.

## First-time setup

```bash
aws login                                   # short-lived session (profile admin)
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply      # creates amr-tfstate-<account>
# platform/ and compute/ read their backend from backend.hcl (see backend.hcl.example);
# the smoke test writes these files for you.
```

## Smoke test (apply → tiny job → destroy)

```bash
AWS_PROFILE=admin infra/scripts/smoke-test.sh
```

Applies `platform` (no-op once it exists) and `compute`, submits one 1-vCPU job **as the
runner role** (so its permissions are tested for real), checks the job wrote to S3 with the host
AWS CLI, waits for Batch to scale back to 0, destroys `compute`, and asks each service whether
anything is left. Compute is destroyed even if a step fails; a failed check is reported, never
silently passed.

### Measured (2026-10-08, eu-west-1, final three-root layout)

| Step | Time |
|---|---|
| `platform` apply (already up to date) | 8 s |
| `compute` apply (21 resources) | 1 min |
| Job submitted as `amr-pipeline-runner` → spot instance up → job done | 2.7 min |
| Scale back to 0 vCPU after the job | 1 min |
| `compute` destroy (21 resources) + leftover check | 3 min |
| **Total** | **7 min** |

AWS Batch creates its own empty default log group `/aws/batch/job` whenever a compute
environment is created. It is not managed here (jobs log to `/amr/batch`), costs nothing, and
is left alone; managing it caused apply failures when Batch re-created it.

One small spot instance for about 4 minutes: well under $0.01 (billing data appears a day later).
`destroy` leaves only the deregistered (`INACTIVE`) job definition `amr-smoke`, which AWS Batch
cannot delete and which costs nothing.

## Running the pipeline on Batch

```bash
AWS_PROFILE=admin infra/scripts/run-on-batch.sh --study <name> --input <samplesheet.csv> [--profile test]
AWS_PROFILE=admin infra/scripts/run-on-batch.sh --study <name> --resume <run_id>   # within 7 days
```

Applies `compute`, makes sure the AMRFinderPlus database is in `s3://<bucket>/refs/` (built and
uploaded once), runs Nextflow on this machine with every task on Batch spot, copies the results
to `runs/<study>/<run>/` and validates them, destroys `compute`, then prices the run's instances
(`cost.json`). Results stay in `s3://<bucket>/results/<study>/<run>/`.

**Failed samples.** A per-sample step that fails is retried once (out-of-memory: twice, with
more memory), then that sample is skipped and recorded as `failed` in `samples.analysis_status`.
The run lists them (`amrtools run-status`); if more than 25% failed, the problem is the run, not
the samples, so the script exits non-zero and writes no `_SUCCESS`.

**Resume.** Each run saves its samplesheet and Nextflow session id next to its results, and
Nextflow's cache in `s3://<bucket>/cache/<study>/<run>/` (Nextflow's cloud cache), so a run cut
short (timeout, cancel, spot shortage) resumes from any machine with `--resume <run_id>`, or
from GitHub with the Cloud run input `resume_run_id`. Finished tasks are reused; `work/` and
`cache/` expire after 7 days.

Nextflow runs as `amr-pipeline-runner`. A role assumed from an `aws login` session counts as role
chaining (1-hour cap), so the script gives Nextflow a temporary AWS config whose
`credential_process` refreshes the runner credentials as needed; `~/.aws/config` is not changed.
Batch jobs use the `amr-batch-job` role (`aws.batch.jobRole`, generated per run because the ARN
contains the account ID).

### Measured: 3 test isolates (2026-10-08)

| | |
|---|---|
| Tasks | 17 (fastp, Shovill, AMRFinderPlus, Kleborate, amrtools) |
| Wall time | 15 min |
| Instances | 4 × c6a/c7i.xlarge spot, 0.57 instance-hours |
| **Cost** | **$0.063 total, $0.021 per genome** (spot compute, disk, public IPv4) |
| Biology | ST13/KPC-2, ST147/NDM, ST23/none: identical to local and CI runs |

At n=3 most of this is fixed overhead (instance boot and the AWS CLI install); expect the cost per
genome to change at study scale. It is re-measured for every run (`runs/<study>/<run>/cost.json`).

## Cloud runs from GitHub (OIDC)

**Actions → Cloud run → Run workflow**, enter a study folder name (see [studies/](../studies/)).
GitHub proves its identity to AWS with a short-lived OIDC token; no AWS keys are stored in
GitHub. Both roles trust only workflows running on `main` of this repository, so forks, pull
requests and other branches cannot assume them. The repository uses GitHub's immutable OIDC
subjects (`repo:owner@<id>/name@<id>:...`), so a renamed and re-registered name never matches. The workflow takes the deployer for Terraform
and the runner for Nextflow, then calls `run-on-batch.sh --ci`. The results, report and cost
are uploaded as a workflow artifact, and a final step destroys compute even if the run failed.

Repository secrets `AWS_DEPLOYER_ROLE_ARN` and `AWS_RUNNER_ROLE_ARN`
(`terraform -chdir=infra/platform output`). Role ARNs are not secret, but secrets are masked in
the public logs, which keeps the account ID out of them; the run files are scrubbed of it too
before upload. Only `cloud-run.yml` and `janitor.yml` may request an OIDC token (a test checks
every workflow), because AWS trusts any job on `main` of this repository.

Safety nets: one cloud run at a time (`concurrency`), a 5.5-hour job limit (GitHub's limit is 6 h),
`max_isolates` per study (at least 1), the 96 vCPU cap (= the account's spot vCPU quota), budgets, and the daily **Janitor**
workflow. The cleanup step destroys compute only if this run created it (a local run in progress
is left alone) and releases a Terraform lock left by a cancel (`destroy-compute.sh`). The Janitor
destroys compute (or a leftover project VPC) that changed over 6 hours ago while no Cloud run is
in progress, and opens an issue either way. A local run longer than 6 hours that overlaps
03:17 UTC would be destroyed by it.

### Measured: rehearsal of the GitHub path, 3 isolates, full ENA reads (2026-10-09)

Run locally with the same two roles and `--ci`: 20 resources applied by the deployer, 17 tasks,
0 failed, results valid, 20 destroyed, nothing left. Wall time 21 min, 0.72 instance-hours,
**$0.095 total, $0.032 per genome** (full-size reads instead of the small test files).

## Checks (CI, no AWS credentials)

`terraform fmt`, `validate` (all roots), `terraform test` (plan tests with a mocked
provider: idle at 0 vCPU, vCPU cap, no inbound access, metadata hop limit, boot script fails
closed, private protected bucket, IAM scoped to project resources incl. the job ARN for SubmitJob), `tflint` (AWS ruleset) and `checkov` (every
skipped check carries a reason next to the resource).
