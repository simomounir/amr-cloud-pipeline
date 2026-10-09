# Phase 4d: One-click cloud runs from GitHub (OIDC) — Design and Plan

Date: 2026-10-09. Approved in conversation. Builds on 4b/4c.

## Design
1. **platform/** adds:
   - `aws_iam_openid_connect_provider` for `token.actions.githubusercontent.com` (audience
     `sts.amazonaws.com`).
   - Trust condition used everywhere: `aud = sts.amazonaws.com` and
     `sub = repo:simomounir/amr-cloud-pipeline:ref:refs/heads/main` (StringEquals; forks, PRs and
     other branches cannot assume).
   - `amr-pipeline-runner` trust gains the GitHub statement (account root kept for local runs).
   - `amr-batch-boundary` managed policy: ceiling for every `amr-batch-*` role (ECS instance
     permissions, CloudWatch Logs for `/amr/batch`, S3 on the project bucket).
   - `amr-compute-deployer` role (GitHub + account root, 12 h): manage only compute resources —
     EC2 networking (create with `Project` request tag; modify/delete with `Project` resource tag;
     describe on `*`), launch templates, Batch CE/queue/job definitions named `amr-*`, log group
     `/amr/batch*`, IAM roles/instance profiles `amr-batch-*` only with the boundary attached
     (`iam:PermissionsBoundary` condition) and only the ECS managed policy attachable; no boundary
     removal; `iam:PassRole` only `amr-batch-*`; Terraform state: read/write `compute/*`, read
     `platform/*`; cost report reads (`ec2:DescribeInstances`, `DescribeSpotPriceHistory`).
2. **compute/**: `amr-batch-instance` and `amr-batch-job` set `permissions_boundary`.
3. **Studies:** `studies/<name>/study.yaml` (`title`, `question`, `organism`, `max_isolates`) and
   `studies/<name>/accessions.txt`. First study: `test` (the 3 test runs).
4. **run-on-batch.sh `--ci`:** credentials come from the environment (deployer for Terraform/AWS,
   `RUNNER_AWS_*` for Nextflow), no `caffeinate`, no profile file. `--max-samples N` truncates the
   samplesheet. Writes `_SUCCESS` after validation.
5. **`cloud-run.yml`** (workflow_dispatch: `study`, `max_isolates`): concurrency group `cloud-run`
   (queue, never cancel), `timeout-minutes: 330`, permissions `id-token: write`, `contents: read`.
   Steps: checkout, Java/Nextflow/Terraform/Python setup, deployer OIDC creds, runner OIDC creds
   (`output-credentials`), `fetch-samples`, `run-on-batch.sh --ci`, upload `runs/` artifact;
   final `if: always()` step destroys compute with deployer creds.
6. **`janitor.yml`** (daily + manual): if `amr-spot` exists and no `Cloud run` is in progress,
   destroy compute and open an issue.

## Testing
- Plan tests (platform): OIDC trust exact `sub`/`aud`; deployer has no wildcard actions, IAM
  actions only on `amr-batch-*`, CreateRole/PutRolePolicy require the boundary, AttachRolePolicy
  only the ECS policy, explicit deny on boundary removal. Compute: both roles carry the boundary.
- checkov/tflint clean.
- Live local: assume the deployer and runner from `admin`, run `run-on-batch.sh --ci` on `test`.
- Live GitHub (after merge to main): dispatch `Cloud run` for `test`; janitor dry run.

## Plan
1. platform: boundary + deployer + OIDC + runner trust, test-first; compute boundary.
2. Studies folder + `--ci`/`--max-samples`/`_SUCCESS` in the run script.
3. Workflows `cloud-run.yml`, `janitor.yml`.
4. Live: apply platform (show plan first), local `--ci` run as deployer/runner.
5. Review, PR, merge (user OK), dispatch `Cloud run` on main.

## Changes after the final review (2026-10-09)
The whole-branch review found what the live rehearsal could not exercise; fixed before merge:
- **No IAM writes for the deployer.** It could create `amr-batch-*` roles with any trust policy
  (e.g. another account), which would outlive `compute/`. `amr-batch-instance`, its instance
  profile and `amr-batch-job` moved to `platform/batch_roles.tf`; the deployer's only IAM action
  is `iam:PassRole` on those two roles. The permissions boundary is no longer needed and is gone
  (items 1 and 2 above are superseded on this point).
- **OIDC tokens only where needed.** The trust `sub` matches any job on `main`, so the Pages
  build job (runs `npm ci`) lost `id-token: write`; a pytest checks that only `cloud-run.yml`
  and `janitor.yml` jobs (or jobs with a deployment environment) can request one.
- **Cleanup only destroys its own compute.** `run-on-batch.sh` touches `AMR_COMPUTE_MARKER` just
  before apply; the workflow's final destroy runs only if that file exists. The Janitor also
  skips compute whose state changed under 6 hours ago and checks for leftover project VPCs.
- **Stale state locks.** `infra/scripts/destroy-compute.sh` releases a lock older than
  `--unlock-after` minutes (0 in the cloud run, 60 in the Janitor) before destroying; the
  Janitor opens its issue whether or not the destroy worked.
- **Caps.** `max_isolates` (study and dispatch input) must be ≥ 1 and is read as decimal;
  `--max-samples 0` is refused. `organism` must match `^[A-Za-z_]+$` and reaches the shell via
  `env`.
- **Account ID out of public output.** Role ARNs are repository secrets (masked in logs),
  `mask-aws-account-id: true`, and run files are scrubbed before the artifact upload
  (`batch-role.config` excluded).
