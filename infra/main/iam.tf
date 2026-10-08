# Four roles, each scoped to this project's bucket and queue.

locals {
  ec2_trust = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }]
  })
  ecs_tasks_trust = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" } }]
  })
  bucket_rw_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
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
    ]
  })
}

# EC2 hosts started by Batch: join the ECS cluster; host AWS CLI stages files to S3.
resource "aws_iam_role" "instance" {
  name               = "amr-batch-instance"
  assume_role_policy = local.ec2_trust
}

resource "aws_iam_role_policy_attachment" "instance_ecs" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_role_policy" "instance_s3" {
  name   = "project-bucket"
  role   = aws_iam_role.instance.id
  policy = local.bucket_rw_policy
}

resource "aws_iam_instance_profile" "instance" {
  name = "amr-batch-instance"
  role = aws_iam_role.instance.name
}

# Each job's container.
resource "aws_iam_role" "job" {
  name               = local.job_role_name
  assume_role_policy = local.ecs_tasks_trust
}

resource "aws_iam_role_policy" "job_s3" {
  name   = "project-bucket"
  role   = aws_iam_role.job.id
  policy = local.bucket_rw_policy
}

# Whoever runs Nextflow: the user via `aws login` now, GitHub OIDC in Phase 4d.
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
  #checkov:skip=CKV_AWS_290:Write actions are scoped to the project queue, job definitions, bucket and job role; checkov counts the read-only "*" statement
  name = "run-pipeline"
  role = aws_iam_role.runner.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SubmitToProjectQueue"
        Effect   = "Allow"
        Action   = ["batch:SubmitJob", "batch:TagResource"]
        Resource = concat([local.queue_arn], local.job_defs)
      },
      {
        Sid      = "ManageProjectJobs"
        Effect   = "Allow"
        Action   = ["batch:TerminateJob", "batch:CancelJob"]
        Resource = "arn:aws:batch:${var.region}:${local.account_id}:job/*"
      },
      {
        Sid      = "DeregisterProjectJobDefinitions"
        Effect   = "Allow"
        Action   = ["batch:DeregisterJobDefinition"]
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
        Sid      = "RegisterProjectJobDefinitions"
        Effect   = "Allow"
        Action   = ["batch:RegisterJobDefinition"]
        Resource = local.job_defs
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
        Resource = "arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/batch/job:*"
      },
    ]
  })
}
