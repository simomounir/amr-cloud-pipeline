# Infrastructure (AWS, Terraform)

Everything the pipeline needs on AWS, as code, split by lifetime: long-lived data and
identity, short-lived compute. Between runs only storage costs anything (pennies).

| Root | What | Lifetime |
|---|---|---|
| `bootstrap/` | S3 bucket `amr-tfstate-<account>` holding the other roots' state (versioned, encrypted, private) | created once, never destroyed |
| `platform/` | S3 bucket `amr-pipeline-<account>` with its protections and lifecycle; IAM roles `amr-pipeline-runner` and `amr-compute-deployer`, GitHub OIDC provider, permissions boundary `amr-batch-boundary` | stays up between runs |
| `compute/` | VPC (public subnets, no NAT), AWS Batch spot compute (0–32 vCPU), job queue, instance and job roles, log group, smoke job | apply → run → destroy |

Budgets (`zero-spend`, `monthly-cap-25`) live outside Terraform so nothing here can remove them.
Destroying `compute/` never touches the bucket or the runner role, so results stay protected
and GitHub can always assume the runner role to start the next run.

## Design notes

- **Region** `eu-west-1`; every resource tagged `Project=amr-cloud-pipeline`, `ManagedBy=terraform`.
- **No NAT gateway** (it costs ~$30/month even idle). Instances get public IPs to reach ENA
  and container registries; the security group allows no inbound traffic.
- **Batch** is spot only (`SPOT_PRICE_CAPACITY_OPTIMIZED`), x86 families c6i/c6a/c7i/m6i/m6a,
  min 0 vCPU (nothing runs at idle), max `var.max_vcpus` (default 32) as a burn-rate cap.
  Hosts use the ECS Amazon Linux 2023 image with a 100 GB disk and a self-contained AWS CLI
  (Miniforge + conda `awscli`) installed at boot in `/opt/aws-cli`. Nextflow mounts it into every
  task container to stage files; the official AWS CLI build fails in minimal images (no `libz`). Instance metadata is limited to
  the host (hop limit 1), so containers only see their own job role.
- **S3** (platform): `work/<study>/<run>/` expires after 7 days; `results/<study>/<run>/` is
  kept. `prevent_destroy` and `force_destroy = false` keep results from being deleted by accident.
- **IAM**, each scoped to this bucket and queue: instance role (ECS only; no S3), job role
  (bucket read/write), Batch service-linked role, and `amr-pipeline-runner` in platform (submits
  jobs, passes only the job role, reads/writes the bucket).
- **Deployer** (`amr-compute-deployer`, platform): the identity that applies and destroys
  `compute/`. It can only touch resources tagged `Project=amr-cloud-pipeline`, Batch resources
  named `amr-*` and the `/amr/batch` log group. It may create IAM roles named `amr-batch-*` only
  with the permissions boundary `amr-batch-boundary` attached (and can never remove it), so the
  roles it creates can never exceed the boundary's permissions: ECS agent, project logs, project bucket.
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
```

Applies `compute`, makes sure the AMRFinderPlus database is in `s3://<bucket>/refs/` (built and
uploaded once), runs Nextflow on this machine with every task on Batch spot, copies the results
to `runs/<study>/<run>/` and validates them, destroys `compute`, then prices the run's instances
(`cost.json`). Results stay in `s3://<bucket>/results/<study>/<run>/`.

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
requests and other branches cannot assume them. The workflow takes the deployer for Terraform
and the runner for Nextflow, then calls `run-on-batch.sh --ci`. The results, report and cost
are uploaded as a workflow artifact, and a final step destroys compute even if the run failed.

Repository variables (role ARNs, not secrets): `AWS_DEPLOYER_ROLE_ARN`, `AWS_RUNNER_ROLE_ARN`
(`terraform -chdir=infra/platform output`).

Safety nets: one cloud run at a time (`concurrency`), a 5.5-hour job limit (GitHub's limit is 6 h),
`max_isolates` per study, the 32 vCPU cap, budgets, and the daily **Janitor** workflow. If compute
exists while no Cloud run is in progress, the Janitor destroys it and opens an issue.

### Measured: rehearsal of the GitHub path, 3 isolates, full ENA reads (2026-10-09)

Run locally with the same two roles and `--ci`: 20 resources applied by the deployer, 17 tasks,
0 failed, results valid, 20 destroyed, nothing left. Wall time 21 min, 0.72 instance-hours,
**$0.095 total, $0.032 per genome** (full-size reads instead of the small test files).

## Checks (CI, no AWS credentials)

`terraform fmt`, `validate` (all roots), `terraform test` (plan tests with a mocked
provider: idle at 0 vCPU, vCPU cap, no inbound access, metadata hop limit, boot script fails
closed, private protected bucket, IAM scoped to project resources incl. the job ARN for SubmitJob), `tflint` (AWS ruleset) and `checkov` (every
skipped check carries a reason next to the resource).
