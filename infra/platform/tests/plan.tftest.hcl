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

run "github_trust_is_main_branch_of_this_repo_only" {
  command = plan

  assert {
    condition     = aws_iam_openid_connect_provider.github.url == "https://token.actions.githubusercontent.com" && contains(aws_iam_openid_connect_provider.github.client_id_list, "sts.amazonaws.com")
    error_message = "GitHub OIDC provider must target token.actions.githubusercontent.com with audience sts.amazonaws.com."
  }
  assert {
    condition = alltrue([
      for policy in [aws_iam_role.deployer.assume_role_policy, aws_iam_role.runner.assume_role_policy] : anytrue([
        for s in jsondecode(policy).Statement :
        s.Action == "sts:AssumeRoleWithWebIdentity" &&
        s.Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:simomounir/amr-cloud-pipeline:ref:refs/heads/main" &&
        s.Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
      ])
    ])
    error_message = "Deployer and runner must trust only main of simomounir/amr-cloud-pipeline."
  }
  assert {
    condition = alltrue([
      for policy in [aws_iam_role.deployer.assume_role_policy, aws_iam_role.runner.assume_role_policy] : alltrue([
        for s in jsondecode(policy).Statement :
        s.Action != "sts:AssumeRoleWithWebIdentity" || !can(s.Condition.StringLike)
      ])
    ])
    error_message = "GitHub trust must use exact StringEquals, never wildcards."
  }
}

run "deployer_is_fenced_in" {
  command = plan

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.deployer.policy).Statement :
      !contains(flatten([s.Action]), "*") && !anytrue([for a in flatten([s.Action]) : endswith(a, ":*")])
    ])
    error_message = "Deployer must not have wildcard actions."
  }
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.deployer.policy).Statement : alltrue([
        for r in flatten([s.Resource]) : startswith(r, "arn:aws:iam::123456789012:role/amr-batch-") || startswith(r, "arn:aws:iam::123456789012:instance-profile/amr-batch-") || startswith(r, "arn:aws:iam::123456789012:policy/amr-batch-boundary")
      ]) if anytrue([for a in flatten([s.Action]) : startswith(a, "iam:")])
    ])
    error_message = "Deployer IAM actions may only touch amr-batch-* roles, instance profiles and the boundary."
  }
  assert {
    condition = alltrue([
      for sid in ["CreateBatchRolesWithBoundary", "WriteBatchRolePoliciesWithBoundary"] :
      jsondecode(aws_iam_role_policy.deployer.policy).Statement[index(jsondecode(aws_iam_role_policy.deployer.policy).Statement[*].Sid, sid)].Condition.StringEquals["iam:PermissionsBoundary"] == "arn:aws:iam::123456789012:policy/amr-batch-boundary"
    ])
    error_message = "Role creation and policy writes require the amr-batch-boundary permissions boundary."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.deployer.policy).Statement[index(jsondecode(aws_iam_role_policy.deployer.policy).Statement[*].Sid, "AttachOnlyEcsPolicy")].Condition.ArnEquals["iam:PolicyARN"] == "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
    error_message = "Only the ECS managed policy may be attached to Batch roles."
  }
  assert {
    condition = contains(
      flatten([jsondecode(aws_iam_role_policy.deployer.policy).Statement[index(jsondecode(aws_iam_role_policy.deployer.policy).Statement[*].Sid, "NeverRemoveBoundary")].Action]),
      "iam:DeleteRolePermissionsBoundary"
    ) && jsondecode(aws_iam_role_policy.deployer.policy).Statement[index(jsondecode(aws_iam_role_policy.deployer.policy).Statement[*].Sid, "NeverRemoveBoundary")].Effect == "Deny"
    error_message = "Deployer must be explicitly denied removing or changing boundaries."
  }
}
