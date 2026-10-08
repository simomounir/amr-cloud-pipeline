# Long-lived: survives every compute destroy. work/<study>/<run>/ (Nextflow scratch, expires
# after 7 days) and results/<study>/<run>/ (kept). force_destroy is off so even retiring the
# platform cannot silently delete results.

resource "aws_s3_bucket" "pipeline" {
  #checkov:skip=CKV_AWS_145:SSE-S3 is sufficient; a KMS key costs ~$1/month in an account kept at ~$0
  #checkov:skip=CKV_AWS_144:Cross-region replication doubles cost; results are published to GitHub Releases
  #checkov:skip=CKV_AWS_18:Access logs need a second bucket; account-level CloudTrail records management events
  #checkov:skip=CKV2_AWS_62:No consumer for event notifications
  #checkov:skip=CKV_AWS_21:Versioning is not useful for scratch and reproducible results
  bucket        = local.bucket_name
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "pipeline" {
  bucket = aws_s3_bucket.pipeline.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "pipeline" {
  bucket                  = aws_s3_bucket.pipeline.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "pipeline" {
  bucket = aws_s3_bucket.pipeline.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "pipeline" {
  bucket = aws_s3_bucket.pipeline.id
  rule {
    id     = "expire-work"
    status = "Enabled"
    filter {
      prefix = "work/"
    }
    expiration {
      days = 7
    }
  }
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
