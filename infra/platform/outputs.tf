output "region" {
  value = var.region
}

output "bucket" {
  value = aws_s3_bucket.pipeline.bucket
}

output "runner_role_arn" {
  value = aws_iam_role.runner.arn
}
