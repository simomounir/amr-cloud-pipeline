# Phase 4b: AWS Infrastructure as Code (Terraform) — Design

Date: 2026-10-08
Status: Approved in conversation; written for review
Builds on: Phase 4a (account cleaned, `aws login` profile `admin`, budgets `zero-spend` and `monthly-cap-25`)
Source brief: `docs/amr-cloud-pipeline-project.md` (sections 4, 6 Phase 4, 8, 9)

## 1. Scope

All AWS infrastructure the pipeline needs, as Terraform in `infra/`, proven by an
apply → smoke job → destroy cycle. About $0 while idle.

**In scope:** Terraform state bootstrap; VPC; S3 bucket; IAM roles; AWS Batch spot
compute environment, job queue and a smoke-test job definition; static checks,
`terraform test` plan tests, CI job; one live smoke test; `infra/README.md`.

**Out of scope:** running the pipeline on Batch (4c), GitHub OIDC (4d), studies and
the cloud-run workflow (4d/4e), the full run and teardown script (4e). Budgets stay
outside Terraform (created in 4a) so `destroy` never removes them.

## 2. Decisions

| Topic | Decision | Reason |
|---|---|---|
| Terraform | 1.16.x, AWS provider 6.x, lock file committed | Current, reproducible |
| State | S3 bucket from a separate `bootstrap/` root, native S3 locking (`use_lockfile`) | CI-ready (4d), no migration later |
| Region | `eu-west-1` | Close to user and to ENA (UK); good spot supply |
| Network | Dedicated VPC, 3 public subnets, internet gateway, no NAT | NAT costs $30+/month idle; data is public |
| Compute | Batch managed EC2, SPOT, `SPOT_PRICE_CAPACITY_OPTIMIZED`, min 0 / max 32 vCPU | Idle $0; hard cap on burn rate |
| Instances | x86 families `c6i, c6a, c7i, m6i, m6a` | Bioinformatics containers are amd64 |
| Host image | ECS-optimised Amazon Linux 2023 (`ECS_AL2023`) | Supported by Batch, current |
| AWS CLI on hosts | Installed at boot to `/opt/aws-cli` (launch template user data) | Nextflow stages files with the host CLI |
| Tags | `Project=amr-cloud-pipeline`, `ManagedBy=terraform` on every resource | Find and cost everything |

## 3. Layout

```
infra/
  bootstrap/            # applied once, never destroyed
    main.tf versions.tf outputs.tf
  main/                 # applied and destroyed per run
    versions.tf backend.tf providers.tf variables.tf
    network.tf storage.tf iam.tf batch.tf outputs.tf
    tests/plan.tftest.hcl
  scripts/smoke-test.sh
  README.md
```

## 4. Bootstrap

- Bucket `amr-tfstate-<account-id>`: versioning on, SSE-S3 encryption, all public
  access blocked, bucket-owner-enforced ownership, `prevent_destroy` lifecycle.
- Local state for the bootstrap root itself (tiny, git-ignored); documented.

## 5. Main root

**Backend:** `s3` with `bucket = amr-tfstate-<account-id>`, `key = main/terraform.tfstate`,
`region = eu-west-1`, `use_lockfile = true`, `encrypt = true`. The bucket name is passed
with `-backend-config` (account ID never committed).

**Network:** VPC `10.42.0.0/16`, one `/20` public subnet per AZ (first 3 AZs),
`map_public_ip_on_launch = true`, internet gateway, one public route table. Security
group `amr-batch`: no ingress, egress all. The VPC's default security group is
managed to have no rules.

**Storage:** bucket `amr-pipeline-<account-id>`: SSE-S3, public access blocked,
bucket-owner-enforced, `force_destroy = false` (destroy fails while results exist).
Lifecycle: `work/` objects expire after 7 days; incomplete multipart uploads abort
after 1 day. Layout convention for later phases: `work/<study>/<run>/`,
`results/<study>/<run>/`.

**IAM** (all policies scoped to the project bucket ARN and the project queue):
- Instance role + instance profile: `AmazonEC2ContainerServiceforEC2Role` + S3
  read/write on the project bucket.
- Job role (ECS task role): S3 read/write on the project bucket.
- Pipeline runner role `amr-pipeline-runner`: Batch submit/describe/list/terminate/
  cancel on the project queue and job definitions named `nf-*` and `amr-*`,
  `batch:RegisterJobDefinition`/`DeregisterJobDefinition` (Batch does not support
  resource scoping for registration), `iam:PassRole` on the job role only, S3
  read/write on the bucket, CloudWatch Logs read on the Batch log group. Trust: the
  account's IAM principals (`Administrator`); 4d adds the GitHub OIDC provider.
- Batch service: the AWS service-linked role (`AWSServiceRoleForBatch`).

**Batch:**
- Launch template: 100 GB gp3 root volume (encrypted); MIME multipart user data that
  installs AWS CLI v2 to `/opt/aws-cli` (`/opt/aws-cli/bin/aws`).
- Compute environment `amr-spot`: managed, `SPOT`, `SPOT_PRICE_CAPACITY_OPTIMIZED`,
  `min_vcpus = 0`, `desired_vcpus = 0`, `max_vcpus = var.max_vcpus` (default 32,
  validated 1–256), instance types above, `ec2_configuration.image_type = ECS_AL2023`,
  subnets and security group above, instance profile above, tags propagated.
- Job queue `amr-queue` (priority 1) → `amr-spot`.
- Job definition `amr-smoke`: `public.ecr.aws/amazonlinux/amazonlinux:2023`, 1 vCPU,
  1 GiB, job role, volume `/opt/aws-cli` mounted read-only, command writes a file to
  `s3://<bucket>/smoke/<job id>.txt` with the host CLI, 1 retry attempt, 10-minute timeout.
- CloudWatch log group `/aws/batch/job` retention 7 days (Batch's default group,
  managed here so retention applies and destroy removes it).

**Outputs:** bucket name, queue name, job role ARN, runner role ARN, region.

## 6. Error handling and cost safety

- Budgets from 4a alert at >$0.01 and at 50%/80%/forecast-100% of $25.
- min 0 vCPU (idle $0), max 32 vCPU cap, 7-day log retention, 7-day work expiry.
- Every apply in this phase is followed by destroy in the same session; the smoke
  script ends with a reminder and a tag-based leftover check.
- `force_destroy = false` protects results from accidental destroy.

## 7. Testing and CI

- **Static (CI, every PR, no AWS):** `terraform fmt -check -recursive`,
  `terraform validate` (both roots, `-backend=false`), `tflint` (AWS ruleset),
  `checkov` (findings fixed or suppressed inline with a reason).
- **Plan tests (CI, no AWS):** `terraform test` with `mock_provider "aws"` asserting:
  min vCPU 0; max vCPU ≤ 32 by default and validation rejects 0 and 1000; no
  `aws_nat_gateway` resources; bucket public access block all true; work lifecycle
  7 days; security group has no ingress; every IAM policy document references only
  the project bucket / queue ARNs (no `"*"` resources except the documented
  `RegisterJobDefinition` and ECS managed policy).
- **Live smoke test (manual, user-approved):** `infra/scripts/smoke-test.sh`:
  apply → submit `amr-smoke` → wait (≤ 15 min) → check S3 object → wait for the
  compute environment to scale to 0 → destroy (empties `smoke/` first) → Tag Editor
  query for `Project=amr-cloud-pipeline` returns nothing. Expected cost < $0.05.

## 8. Requirements carried to 4d/4e (studies)

The user will design their own studies and runs. 4b must not block this:
- S3 prefixes per study/run (section 5).
- Batch jobs will carry `Study` and `Run` tags (Nextflow `resourceLabels` in 4c) so
  Cost Explorer can report cost per study; `propagate_tags` is enabled.
- 4d/4e design: `studies/<name>/study.yaml` (title, question, organism, accessions or
  ENA query, `max_isolates`), a "Cloud run" workflow taking a study name, per-study
  dataset releases, and a dashboard study selector.

## 9. Done criteria

- Bootstrap bucket exists (versioned, locked state works).
- Smoke test: apply → job succeeds → scale to 0 → destroy → zero tagged resources left;
  measured cost recorded in `infra/README.md`.
- CI `infra` job (fmt, validate, tflint, checkov, terraform test) green on main.

## 10. Amendments after the final review

- **Three roots by lifetime** (supersedes `main/`): `bootstrap/` (state), `platform/`
  (pipeline bucket with protections + `amr-pipeline-runner`, long-lived), `compute/` (network,
  Batch, instance/job roles, log group; apply → run → destroy). Reason: destroying a single
  root stripped the bucket's protections before failing on non-empty results, and deleted the
  runner role that GitHub OIDC (4d) must assume between runs.
- Runner `SubmitJob`/`TagResource` also allow `job/*` (AWS requires the job ARN). The smoke test
  submits as the runner role so its policy is exercised live.
- `RegisterJobDefinition` **is** resource-scoped (to `nf-*`/`amr-*`); §5's claim was wrong.
- Instance role has no S3 access (containers use the job role; metadata hop limit 1).
- Boot script retries downloads, verifies the CLI and shuts the host down on failure.
- No plan test asserts "no NAT/EIP" (Terraform tests cannot assert a resource type is absent);
  absence is visible in review and in the smoke test's resource count.
