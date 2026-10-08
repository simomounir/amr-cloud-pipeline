# Phase 4b Terraform Implementation Plan

> Inline execution. Compact plan by user request ("keep going"): tasks, files and checks;
> Terraform is written test-first during execution rather than duplicated here.

**Goal:** `infra/` Terraform (bootstrap + main) for VPC, S3, IAM and AWS Batch spot, proven by
plan tests in CI and one live apply → smoke job → destroy.

**Spec:** `docs/superpowers/specs/2026-10-08-phase4b-terraform-design.md`

## Global Constraints
- Terraform 1.16.x, `hashicorp/aws` ~> 6.0; lock files committed; region `eu-west-1`.
- Tags `Project=amr-cloud-pipeline`, `ManagedBy=terraform` via provider `default_tags`.
- No account ID, keys or state in git. `AWS_PROFILE=admin` exported for every AWS command.
- No `terraform apply` or AWS change without the user's explicit OK in this session; every
  main-root apply is followed by destroy in the same session.
- Branch `phase4b-terraform`; no pushes without OK; no co-author trailers.

## Review Focus
1. IAM wildcards: runner/instance/job policies must not grant `s3:*` on `*` or Batch on `*`
   beyond the documented `RegisterJobDefinition`. Pinned by plan tests.
2. Destroy with results in the bucket must fail, not silently delete. Pinned by a plan test on
   `force_destroy = false`; smoke script empties only `smoke/`.
3. Idle cost: min/desired vCPU 0, no NAT, no Elastic IPs. Pinned by plan tests.
4. Launch template user data must be valid MIME multipart (Batch rejects otherwise) and the CLI
   path must match the smoke job's mount. Verified live by the smoke job.
5. A failed smoke test must still destroy. Pinned by `trap` in the script; verified by reading.

## Tasks
1. **Tooling:** Terraform 1.16.x, tflint, checkov into user-level locations (checksums verified).
2. **Bootstrap root** (`infra/bootstrap`): state bucket with versioning, encryption, public access
   block, ownership controls, `prevent_destroy`. Check: `fmt`, `validate`, checkov clean.
3. **Main root, test-first** (`infra/main`): write `tests/plan.tftest.hcl` with mock provider
   (assertions per spec §7), watch it fail, then network.tf, storage.tf, iam.tf, batch.tf,
   outputs.tf until green. Check: `terraform test`, `fmt`, `validate`.
4. **Static analysis + CI:** `.tflint.hcl` (AWS ruleset), checkov run with inline, reasoned
   suppressions; `infra` job in `ci.yml` (fmt, validate both roots, tflint, checkov,
   terraform test). Check: all green locally.
5. **Smoke script + README:** `infra/scripts/smoke-test.sh` (apply → submit → wait → verify S3 →
   wait scale-to-0 → empty `smoke/` → destroy → tag check; `trap` destroys on failure);
   `infra/README.md`. Check: `bash -n`, shellcheck if available.
6. **Live (user OK required):** bootstrap apply; smoke test; record cost and timings in README.
7. **Final review** (fresh reviewer), fixes, PR, merge with user OK.
