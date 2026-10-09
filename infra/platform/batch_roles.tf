# Roles for the machines and containers Batch starts. They cost nothing idle, so they live here
# (applied by an admin) rather than in compute/: the deployer that applies compute/ then needs no
# IAM write permission at all, only iam:PassRole on these two roles.

locals {
  ec2_trust = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }]
  })
  ecs_tasks_trust = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" } }]
  })
}

# EC2 hosts started by Batch: only join the ECS cluster. Containers cannot reach the host's
# credentials (metadata hop limit 1 in compute/); they use the job role, which has the S3 access.
resource "aws_iam_role" "batch_instance" {
  name               = "amr-batch-instance"
  assume_role_policy = local.ec2_trust
}

resource "aws_iam_role_policy_attachment" "batch_instance_ecs" {
  role       = aws_iam_role.batch_instance.name
  policy_arn = local.ecs_policy_arn
}

resource "aws_iam_instance_profile" "batch_instance" {
  name = "amr-batch-instance"
  role = aws_iam_role.batch_instance.name
}

# Each job's container.
resource "aws_iam_role" "batch_job" {
  name               = "amr-batch-job"
  assume_role_policy = local.ecs_tasks_trust
}

resource "aws_iam_role_policy" "batch_job_s3" {
  name = "project-bucket"
  role = aws_iam_role.batch_job.id
  policy = jsonencode({
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
