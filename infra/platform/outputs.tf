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

output "batch_instance_profile_arn" {
  value = aws_iam_instance_profile.batch_instance.arn
}

output "batch_job_role_arn" {
  value = aws_iam_role.batch_job.arn
}
