output "region" {
  value = var.region
}

output "bucket" {
  value = aws_s3_bucket.pipeline.bucket
}

output "runner_role_arn" {
  value = aws_iam_role.runner.arn
}

output "deployer_role_arn" {
  value = aws_iam_role.deployer.arn
}

output "batch_boundary_arn" {
  value = aws_iam_policy.batch_boundary.arn
}
