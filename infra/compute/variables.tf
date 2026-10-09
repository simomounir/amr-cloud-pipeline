variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "eu-west-1"
}

variable "max_vcpus" {
  description = "Hard cap on vCPUs Batch may run at once (cost guard; equals the account's spot vCPU quota)."
  type        = number
  default     = 96
  validation {
    condition     = var.max_vcpus >= 1 && var.max_vcpus <= 256
    error_message = "max_vcpus must be between 1 and 256."
  }
}

variable "instance_families" {
  description = "x86 instance families for spot capacity (bioinformatics images are amd64)."
  type        = list(string)
  default     = ["c6i", "c6a", "c7i", "m6i", "m6a"]
}

data "aws_caller_identity" "current" {}

locals {
  project     = "amr-cloud-pipeline"
  account_id  = data.aws_caller_identity.current.account_id
  bucket_name = "amr-pipeline-${local.account_id}"
  queue_name  = "amr-queue"
  log_group   = "/amr/batch"
  aws_cli_dir = "/opt/aws-cli"
  # Pinned to what the 2026-10-09 cloud runs used. To update: take a release from
  # github.com/conda-forge/miniforge/releases with its .sha256 file, and an awscli version from
  # conda-forge, then run the smoke test.
  miniforge_version = "26.7.2-0"
  miniforge_sha256  = "281b0ac7d550802efc81af633225a5e6116d29ae72f3ab4eae7168c3931a4c05"
  awscli_version    = "2.37.10"
  # Created by infra/platform (batch_roles.tf); compute/ creates no IAM, so its deployer needs
  # only iam:PassRole on these.
  instance_profile_arn = "arn:aws:iam::${local.account_id}:instance-profile/amr-batch-instance"
  job_role_arn         = "arn:aws:iam::${local.account_id}:role/amr-batch-job"
  tags = {
    Project   = local.project
    ManagedBy = "terraform"
    Component = "compute"
  }
}
