variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "eu-west-1"
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
  tags = {
    Project   = local.project
    ManagedBy = "terraform"
    Component = "platform"
  }
}
