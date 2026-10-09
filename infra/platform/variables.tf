variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "eu-west-1"
}

variable "github_subject_prefix" {
  description = <<-EOT
    OIDC subject prefix of the only GitHub repository allowed to assume project roles. The
    repository uses GitHub's immutable subjects (owner@owner_id/repo@repo_id), so a renamed and
    re-registered owner or repository can never match. Shown by:
    gh api repos/<owner>/<repo>/actions/oidc/customization/sub (sub_claim_prefix).
  EOT
  type        = string
  default     = "repo:simomounir@18674957/amr-cloud-pipeline@1407768850"
}

data "aws_caller_identity" "current" {}

locals {
  project     = "amr-cloud-pipeline"
  account_id  = data.aws_caller_identity.current.account_id
  bucket_name = "amr-pipeline-${local.account_id}"
  bucket_arn  = "arn:aws:s3:::${local.bucket_name}"
  # Compute-root names, referenced by ARN so this root does not depend on compute existing.
  queue_arn    = "arn:aws:batch:${var.region}:${local.account_id}:job-queue/amr-queue"
  jobs_arn     = "arn:aws:batch:${var.region}:${local.account_id}:job/*"
  job_defs     = ["arn:aws:batch:${var.region}:${local.account_id}:job-definition/nf-*", "arn:aws:batch:${var.region}:${local.account_id}:job-definition/amr-*"]
  job_role_arn = "arn:aws:iam::${local.account_id}:role/amr-batch-job"
  # amr-batch-instance and amr-batch-job are created in batch_roles.tf.
  instance_role_arn = "arn:aws:iam::${local.account_id}:role/amr-batch-instance"
  log_group_arn     = "arn:aws:logs:${var.region}:${local.account_id}:log-group:/amr/batch:*"
  state_bucket      = "amr-tfstate-${local.account_id}"
  # Built from names so policies are fully known at plan time.
  github_oidc_arn = "arn:aws:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com"
  ecs_policy_arn  = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
  # Only workflows on main of this repository; forks, PRs and other branches are refused.
  github_trust_statement = {
    Effect    = "Allow"
    Action    = "sts:AssumeRoleWithWebIdentity"
    Principal = { Federated = local.github_oidc_arn }
    Condition = {
      StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "${var.github_subject_prefix}:ref:refs/heads/main"
      }
    }
  }
  account_trust_statement = {
    Effect    = "Allow"
    Action    = "sts:AssumeRole"
    Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
  }
  tags = {
    Project   = local.project
    ManagedBy = "terraform"
    Component = "platform"
  }
}
