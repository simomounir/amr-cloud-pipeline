variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "eu-west-1"
}

variable "max_vcpus" {
  description = "Hard cap on vCPUs Batch may run at once (cost guard)."
  type        = number
  default     = 32
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
  bucket_arn  = "arn:aws:s3:::${local.bucket_name}"
  queue_name  = "amr-queue"
  log_group   = "/amr/batch"
  aws_cli_dir = "/opt/aws-cli"
  # The platform root's runner policy passes this role by its fixed name.
  job_role_name = "amr-batch-job"
  # Created by infra/platform; every amr-batch-* role must carry it.
  boundary_arn = "arn:aws:iam::${local.account_id}:policy/amr-batch-boundary"
  tags = {
    Project   = local.project
    ManagedBy = "terraform"
    Component = "compute"
  }
}
