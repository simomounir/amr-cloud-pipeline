output "region" {
  value = var.region
}

output "bucket" {
  value = aws_s3_bucket.pipeline.bucket
}

output "job_queue" {
  value = aws_batch_job_queue.main.name
}

output "job_role_arn" {
  value = aws_iam_role.job.arn
}

output "runner_role_arn" {
  value = aws_iam_role.runner.arn
}

output "smoke_job_definition" {
  value = aws_batch_job_definition.smoke.name
}
