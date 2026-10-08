# Plan-only tests with a mocked AWS provider: no credentials, no cost.

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}

run "bucket_is_private_and_protected" {
  command = plan

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.pipeline.block_public_acls,
      aws_s3_bucket_public_access_block.pipeline.block_public_policy,
      aws_s3_bucket_public_access_block.pipeline.ignore_public_acls,
      aws_s3_bucket_public_access_block.pipeline.restrict_public_buckets,
    ])
    error_message = "All S3 public access must be blocked."
  }
  assert {
    condition     = aws_s3_bucket.pipeline.force_destroy == false
    error_message = "Destroy must never silently delete results."
  }
  assert {
    condition = one([
      for r in aws_s3_bucket_lifecycle_configuration.pipeline.rule : r.expiration[0].days if r.id == "expire-work"
    ]) == 7
    error_message = "work/ objects must expire after 7 days."
  }
}

run "runner_is_scoped_to_project_resources" {
  command = plan

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.runner.policy).Statement :
      s.Sid == "BatchReadOnly" || !contains(flatten([s.Resource]), "*")
    ])
    error_message = "Only the BatchReadOnly statement may use Resource '*'."
  }
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.runner.policy).Statement :
      !contains(flatten([s.Action]), "*") && !contains(flatten([s.Action]), "s3:*") && !contains(flatten([s.Action]), "batch:*")
    ])
    error_message = "Runner policy must not grant wildcard actions."
  }
  assert {
    condition = contains(
      jsondecode(aws_iam_role_policy.runner.policy).Statement[index(jsondecode(aws_iam_role_policy.runner.policy).Statement[*].Sid, "SubmitToProjectQueue")].Resource,
      "arn:aws:batch:eu-west-1:123456789012:job/*"
    )
    error_message = "SubmitJob and TagResource also require the job ARN."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.runner.policy).Statement[index(jsondecode(aws_iam_role_policy.runner.policy).Statement[*].Sid, "PassJobRole")].Resource == "arn:aws:iam::123456789012:role/amr-batch-job"
    error_message = "Runner may pass only the job role."
  }
}
