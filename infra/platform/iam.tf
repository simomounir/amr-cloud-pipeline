# Long-lived identity: whoever runs Nextflow (the user via `aws login` now; GitHub OIDC in
# Phase 4d). It must exist between runs, so it lives here rather than in compute/.

resource "aws_iam_role" "runner" {
  name = "amr-pipeline-runner"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
    }]
  })
  max_session_duration = 43200
}

resource "aws_iam_role_policy" "runner" {
  #checkov:skip=CKV_AWS_355:Only the BatchReadOnly statement uses "*"; AWS has no resource-level scoping for Describe/List calls
  #checkov:skip=CKV_AWS_290:Write actions are scoped to the project queue, jobs, job definitions, bucket and job role; checkov counts the read-only "*" statement
  name = "run-pipeline"
  role = aws_iam_role.runner.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # SubmitJob and TagResource need the job ARN as well as the queue and definition.
        Sid      = "SubmitToProjectQueue"
        Effect   = "Allow"
        Action   = ["batch:SubmitJob", "batch:TagResource"]
        Resource = concat([local.queue_arn, local.jobs_arn], local.job_defs)
      },
      {
        Sid      = "ManageProjectJobs"
        Effect   = "Allow"
        Action   = ["batch:TerminateJob", "batch:CancelJob"]
        Resource = local.jobs_arn
      },
      {
        Sid      = "ManageProjectJobDefinitions"
        Effect   = "Allow"
        Action   = ["batch:RegisterJobDefinition", "batch:DeregisterJobDefinition"]
        Resource = local.job_defs
      },
      {
        # AWS does not support resource-level scoping for these calls.
        Sid    = "BatchReadOnly"
        Effect = "Allow"
        Action = [
          "batch:DescribeJobs", "batch:DescribeJobQueues", "batch:DescribeComputeEnvironments",
          "batch:DescribeJobDefinitions", "batch:ListJobs",
        ]
        Resource = "*"
      },
      {
        Sid      = "PassJobRole"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = local.job_role_arn
      },
      {
        Sid      = "ListProjectBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = local.bucket_arn
      },
      {
        Sid      = "ReadWriteProjectObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
        Resource = "${local.bucket_arn}/*"
      },
      {
        Sid      = "ReadJobLogs"
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:DescribeLogStreams"]
        Resource = local.log_group_arn
      },
    ]
  })
}
