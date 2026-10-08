# Per-run roles for the machines and containers Batch starts. The runner role lives in
# platform/ because it must exist between runs.

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

# EC2 hosts started by Batch: only join the ECS cluster. Containers cannot reach the host's
# credentials (metadata hop limit 1); they use the job role, which has the S3 access.
resource "aws_iam_role" "instance" {
  name                 = "amr-batch-instance"
  assume_role_policy   = local.ec2_trust
  permissions_boundary = local.boundary_arn
}

resource "aws_iam_role_policy_attachment" "instance_ecs" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_instance_profile" "instance" {
  name = "amr-batch-instance"
  role = aws_iam_role.instance.name
}

# Each job's container.
resource "aws_iam_role" "job" {
  name                 = local.job_role_name
  assume_role_policy   = local.ecs_tasks_trust
  permissions_boundary = local.boundary_arn
}

resource "aws_iam_role_policy" "job_s3" {
  name   = "project-bucket"
  role   = aws_iam_role.job.id
  policy = local.bucket_rw_policy
}
