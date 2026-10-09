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
    condition     = aws_batch_compute_environment.spot.compute_resources[0].max_vcpus == 96
    error_message = "Default vCPU cap must be 96 (the account's spot vCPU quota in eu-west-1)."
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
    condition     = length(aws_subnet.public) == 3
    error_message = "One public subnet per availability zone (3)."
  }
}

run "uses_platform_roles" {
  command = plan

  # The roles live in platform/; compute/ creates none, so its deployer needs no IAM writes.
  assert {
    condition     = aws_batch_compute_environment.spot.compute_resources[0].instance_role == "arn:aws:iam::123456789012:instance-profile/amr-batch-instance"
    error_message = "Hosts use the platform instance profile amr-batch-instance."
  }
  assert {
    condition     = output.job_role_arn == "arn:aws:iam::123456789012:role/amr-batch-job"
    error_message = "Jobs use the platform job role amr-batch-job."
  }
  assert {
    condition     = aws_launch_template.batch.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "Containers must not reach instance metadata (hop limit 1)."
  }
}

run "logs_use_project_group" {
  command = plan

  assert {
    condition     = aws_cloudwatch_log_group.batch.name == "/amr/batch" && aws_cloudwatch_log_group.batch.retention_in_days == 7
    error_message = "Jobs log to the project group /amr/batch (7-day retention), not Batch's default group."
  }
}

run "boot_script_fails_closed" {
  command = plan

  assert {
    condition     = strcontains(base64decode(aws_launch_template.batch.user_data), "shutdown -h now")
    error_message = "A failed AWS CLI install must shut the host down so Batch replaces it."
  }
  assert {
    condition     = strcontains(base64decode(aws_launch_template.batch.user_data), "/opt/aws-cli/bin/aws --version")
    error_message = "The boot script must verify the AWS CLI it installed."
  }
}
