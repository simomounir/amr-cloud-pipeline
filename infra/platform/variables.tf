variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "eu-west-1"
}

variable "github_repository" {
  description = "owner/name of the only GitHub repository allowed to assume project roles."
  type        = string
  default     = "simomounir/amr-cloud-pipeline"
}

data "aws_caller_identity" "current" {}

locals {
  project     = "amr-cloud-pipeline"
  account_id  = data.aws_caller_identity.current.account_id
  bucket_name = "amr-pipeline-${local.account_id}"
  bucket_arn  = "arn:aws:s3:::${local.bucket_name}"
  # Compute-root names, referenced by ARN so this root does not depend on compute existing.
  queue_arn     = "arn:aws:batch:${var.region}:${local.account_id}:job-queue/amr-queue"
  jobs_arn      = "arn:aws:batch:${var.region}:${local.account_id}:job/*"
  job_defs      = ["arn:aws:batch:${var.region}:${local.account_id}:job-definition/nf-*", "arn:aws:batch:${var.region}:${local.account_id}:job-definition/amr-*"]
  job_role_arn  = "arn:aws:iam::${local.account_id}:role/amr-batch-job"
  log_group_arn = "arn:aws:logs:${var.region}:${local.account_id}:log-group:/amr/batch:*"
  state_bucket  = "amr-tfstate-${local.account_id}"
  # Built from names so policies are fully known at plan time.
  github_oidc_arn = "arn:aws:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com"
  boundary_arn    = "arn:aws:iam::${local.account_id}:policy/amr-batch-boundary"
  batch_roles     = "arn:aws:iam::${local.account_id}:role/amr-batch-*"
  batch_profiles  = "arn:aws:iam::${local.account_id}:instance-profile/amr-batch-*"
  ecs_policy_arn  = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
  # Only workflows on main of this repository; forks, PRs and other branches are refused.
  github_trust_statement = {
    Effect    = "Allow"
    Action    = "sts:AssumeRoleWithWebIdentity"
    Principal = { Federated = local.github_oidc_arn }
    Condition = {
      StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:ref:refs/heads/main"
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
