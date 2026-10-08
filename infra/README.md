# Infrastructure (AWS, Terraform)

Everything the pipeline needs on AWS, as code. `infra/main` is created for a run and
destroyed afterwards; at idle it costs about $0.

| Root | What | Lifetime |
|---|---|---|
| `bootstrap/` | S3 bucket `amr-tfstate-<account>` holding `main`'s state (versioned, encrypted, private) | created once, never destroyed |
| `main/` | VPC (public subnets, no NAT), S3 bucket `amr-pipeline-<account>`, IAM roles, AWS Batch spot compute (0–32 vCPU), job queue, smoke job | apply → run → destroy |

Budgets (`zero-spend`, `monthly-cap-25`) live outside Terraform so destroy never removes them.

## Design notes

- **Region** `eu-west-1`; every resource tagged `Project=amr-cloud-pipeline`, `ManagedBy=terraform`.
- **No NAT gateway** (it costs ~$30/month even idle). Instances get public IPs to reach ENA
  and container registries; the security group allows no inbound traffic.
- **Batch** is spot only (`SPOT_PRICE_CAPACITY_OPTIMIZED`), x86 families c6i/c6a/c7i/m6i/m6a,
  min 0 vCPU (nothing runs at idle), max `var.max_vcpus` (default 32) as a burn-rate cap.
  Hosts use the ECS Amazon Linux 2023 image with a 100 GB disk and the AWS CLI installed at
  boot in `/opt/aws-cli` (Nextflow stages files with it). Instance metadata is limited to
  the host (hop limit 1), so containers only see their own job role.
- **S3**: `work/<study>/<run>/` expires after 7 days; `results/<study>/<run>/` is kept.
  `force_destroy = false`: destroy fails while results remain, so they cannot be deleted
  by accident.
- **IAM**, each scoped to this bucket and queue: instance role, job role, Batch
  service-linked role, and `amr-pipeline-runner` (what runs Nextflow; GitHub OIDC joins in 4d).

## First-time setup

```bash
aws login                                   # short-lived session (profile admin)
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply      # creates amr-tfstate-<account>
```

## Smoke test (apply → tiny job → destroy)

```bash
AWS_PROFILE=admin infra/scripts/smoke-test.sh
```

Applies `main`, runs one 1-vCPU job that writes to S3 with the host AWS CLI, waits for
Batch to scale back to 0, destroys everything, and checks that no tagged resources remain.
Destroy runs even if a step fails.

## Checks (CI, no AWS credentials)

`terraform fmt`, `validate` (both roots), `terraform test` (plan tests with a mocked
provider: idle at 0 vCPU, vCPU cap, no inbound access, private protected bucket, IAM scoped
to project resources, metadata hop limit), `tflint` (AWS ruleset) and `checkov` (every
skipped check carries a reason next to the resource).
