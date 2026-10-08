# Applied once and never destroyed: the S3 bucket that holds infra/main's Terraform state.
# Its own state stays local (git-ignored); it only ever manages this one bucket.

variable "region" {
  type    = string
  default = "eu-west-1"
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "state" {
  #checkov:skip=CKV_AWS_145:SSE-S3 is sufficient for state; a KMS key costs ~$1/month in an account kept at ~$0
  #checkov:skip=CKV_AWS_144:Cross-region replication doubles cost; versioning covers recovery for a one-person project
  #checkov:skip=CKV_AWS_18:Access logs need a second bucket; account-level CloudTrail records management events
  #checkov:skip=CKV2_AWS_62:No consumer for event notifications on a state bucket
  bucket = "amr-tfstate-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Keep old state versions for 90 days so a bad apply can be rolled back, then expire them.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}
