# Plan-only tests with a mocked AWS provider: no credentials, no cost.
# They pin the properties that keep this infrastructure cheap and least-privilege.

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["eu-west-1a", "eu-west-1b", "eu-west-1c"] }
  }
}

run "idle_cost_is_zero" {
  command = plan

  assert {
    condition     = aws_batch_compute_environment.spot.compute_resources[0].min_vcpus == 0
    error_message = "Compute environment must scale to zero when idle."
  }
  assert {
    condition     = aws_batch_compute_environment.spot.compute_resources[0].desired_vcpus == 0
    error_message = "Desired vCPUs must start at zero."
  }
  assert {
    condition     = aws_batch_compute_environment.spot.compute_resources[0].max_vcpus == 32
    error_message = "Default vCPU cap must be 32."
  }
  assert {
    condition     = aws_batch_compute_environment.spot.compute_resources[0].type == "SPOT"
    error_message = "Compute must use spot instances."
  }
}

run "vcpu_cap_rejects_zero" {
  command = plan
  variables { max_vcpus = 0 }
  expect_failures = [var.max_vcpus]
}

run "vcpu_cap_rejects_runaway" {
  command = plan
  variables { max_vcpus = 1000 }
  expect_failures = [var.max_vcpus]
}

run "network_has_no_inbound_access" {
  command = plan

  assert {
    condition     = length(aws_security_group.batch.ingress) == 0
    error_message = "Batch security group must not allow inbound traffic."
  }
  assert {
    condition     = length(aws_default_security_group.default.ingress) == 0 && length(aws_default_security_group.default.egress) == 0
    error_message = "The VPC default security group must have no rules."
  }
  assert {
    condition     = length(aws_subnet.public) == 3
    error_message = "One public subnet per availability zone (3)."
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
    error_message = "Destroy must refuse to delete a bucket that still holds results."
  }
  assert {
    condition = one([
      for r in aws_s3_bucket_lifecycle_configuration.pipeline.rule : r.expiration[0].days if r.id == "expire-work"
    ]) == 7
    error_message = "work/ objects must expire after 7 days."
  }
}

run "iam_is_scoped_to_project_resources" {
  command = plan

  # Only Batch read-only calls may use Resource "*" (AWS has no resource-level scoping for them).
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.runner.policy).Statement :
      s.Sid == "BatchReadOnly" || !contains(flatten([s.Resource]), "*")
    ])
    error_message = "Runner policy may only use '*' in the documented statements."
  }
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.runner.policy).Statement :
      !contains(flatten([s.Action]), "*") && !contains(flatten([s.Action]), "s3:*") && !contains(flatten([s.Action]), "batch:*")
    ])
    error_message = "Runner policy must not grant wildcard actions."
  }
  assert {
    condition = alltrue(flatten([
      for p in [aws_iam_role_policy.job_s3.policy, aws_iam_role_policy.instance_s3.policy] : [
        for s in jsondecode(p).Statement : [
          for r in flatten([s.Resource]) : startswith(r, "arn:aws:s3:::amr-pipeline-123456789012")
        ]
      ]
    ]))
    error_message = "Job and instance S3 access must be limited to the project bucket."
  }
  assert {
    condition     = aws_launch_template.batch.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "Containers must not reach instance metadata (hop limit 1)."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.runner.policy).Statement[index(jsondecode(aws_iam_role_policy.runner.policy).Statement[*].Sid, "PassJobRole")].Resource == "arn:aws:iam::123456789012:role/amr-batch-job"
    error_message = "Runner may pass only the job role."
  }
}
