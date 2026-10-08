output "region" {
  value = var.region
}

output "bucket" {
  description = "Platform bucket used by jobs (created by infra/platform)."
  value       = local.bucket_name
}

output "job_queue" {
  value = aws_batch_job_queue.main.name
}

output "job_role_arn" {
  value = aws_iam_role.job.arn
}

output "smoke_job_definition" {
  value = aws_batch_job_definition.smoke.name
}

output "log_group" {
  value = aws_cloudwatch_log_group.batch.name
}
