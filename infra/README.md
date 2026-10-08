# Infrastructure (AWS, Terraform)

Everything the pipeline needs on AWS, as code, split by lifetime: long-lived data and
identity, short-lived compute. Between runs only storage costs anything (pennies).

| Root | What | Lifetime |
|---|---|---|
| `bootstrap/` | S3 bucket `amr-tfstate-<account>` holding the other roots' state (versioned, encrypted, private) | created once, never destroyed |
| `platform/` | S3 bucket `amr-pipeline-<account>` with its protections and lifecycle; IAM role `amr-pipeline-runner` (GitHub OIDC joins in 4d) | stays up between runs |
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
  Hosts use the ECS Amazon Linux 2023 image with a 100 GB disk and the AWS CLI installed at
  boot in `/opt/aws-cli` (Nextflow stages files with it). Instance metadata is limited to
  the host (hop limit 1), so containers only see their own job role.
- **S3** (platform): `work/<study>/<run>/` expires after 7 days; `results/<study>/<run>/` is
  kept. `prevent_destroy` and `force_destroy = false` keep results from being deleted by accident.
- **IAM**, each scoped to this bucket and queue: instance role (ECS only; no S3), job role
  (bucket read/write), Batch service-linked role, and `amr-pipeline-runner` in platform (submits
  jobs, passes only the job role, reads/writes the bucket).
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

### Measured (2026-10-08, eu-west-1)

| Step | Time |
|---|---|
| `terraform apply` (29 resources) | 1 min 20 s |
| Job queued → spot instance up → job done | 4 min (3.7 min is instance start + AWS CLI install) |
| Scale back to 0 vCPU after the job | 2 min |
| `terraform destroy` (29 resources) | 2.5 min |
| **Total** | **11 min** |

One small spot instance for about 4 minutes: well under $0.01 (billing data appears a day later).
`destroy` leaves only the deregistered (`INACTIVE`) job definition `amr-smoke`, which AWS Batch
cannot delete and which costs nothing.

## Checks (CI, no AWS credentials)

`terraform fmt`, `validate` (all roots), `terraform test` (plan tests with a mocked
provider: idle at 0 vCPU, vCPU cap, no inbound access, metadata hop limit, boot script fails
closed, private protected bucket, IAM scoped to project resources incl. the job ARN for SubmitJob), `tflint` (AWS ruleset) and `checkov` (every
skipped check carries a reason next to the resource).
