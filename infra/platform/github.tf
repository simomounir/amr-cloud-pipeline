# GitHub Actions → AWS without stored keys. AWS verifies GitHub's OIDC token; only workflows on
# main of var.github_repository can assume the deployer (Terraform for compute/) or the runner
# (Nextflow). Each role is assumed directly from the web identity, so sessions are not
# "chained" and can last a whole run.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "deployer" {
  name        = "amr-compute-deployer"
  description = "Applies and destroys infra/compute (GitHub Actions on main, or the account's admins)"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.account_trust_statement, local.github_trust_statement]
  })
  max_session_duration = 43200
}

resource "aws_iam_role_policy" "deployer" {
  #checkov:skip=CKV_AWS_355:Describe/List calls and tag-conditioned EC2 actions cannot be resource-scoped by ARN
  #checkov:skip=CKV_AWS_290:EC2 writes are fenced by Project tag conditions; the only IAM action is PassRole on the two Batch roles
  name = "manage-compute"
  role = aws_iam_role.deployer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Ec2Read"
        Effect   = "Allow"
        Action   = ["ec2:Describe*"]
        Resource = "*"
      },
      {
        # New resources must be created with the project tag.
        Sid    = "Ec2CreateTagged"
        Effect = "Allow"
        Action = [
          "ec2:CreateVpc", "ec2:CreateSubnet", "ec2:CreateInternetGateway", "ec2:CreateRouteTable",
          "ec2:CreateSecurityGroup", "ec2:CreateLaunchTemplate",
        ]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestTag/Project" = local.project } }
      },
      {
        # Creating a subnet, route table or security group is also authorised against the VPC
        # it goes into; allow that only for the project's (tagged) VPC.
        Sid       = "Ec2CreateInProjectVpc"
        Effect    = "Allow"
        Action    = ["ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup"]
        Resource  = "arn:aws:ec2:${var.region}:${local.account_id}:vpc/*"
        Condition = { StringEquals = { "aws:ResourceTag/Project" = local.project } }
      },
      {
        Sid       = "Ec2TagOnCreate"
        Effect    = "Allow"
        Action    = ["ec2:CreateTags"]
        Resource  = "*"
        Condition = { StringEquals = { "ec2:CreateAction" = ["CreateVpc", "CreateSubnet", "CreateInternetGateway", "CreateRouteTable", "CreateSecurityGroup", "CreateLaunchTemplate"] } }
      },
      {
        # Existing resources can only be changed or deleted if they carry the project tag.
        Sid    = "Ec2ManageTagged"
        Effect = "Allow"
        Action = [
          "ec2:DeleteVpc", "ec2:ModifyVpcAttribute", "ec2:DeleteSubnet", "ec2:ModifySubnetAttribute",
          "ec2:AttachInternetGateway", "ec2:DetachInternetGateway", "ec2:DeleteInternetGateway",
          "ec2:CreateRoute", "ec2:ReplaceRoute", "ec2:DeleteRoute", "ec2:AssociateRouteTable",
          "ec2:DisassociateRouteTable", "ec2:DeleteRouteTable", "ec2:AuthorizeSecurityGroupEgress",
          "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress", "ec2:DeleteSecurityGroup", "ec2:CreateLaunchTemplateVersion",
          "ec2:ModifyLaunchTemplate", "ec2:DeleteLaunchTemplate", "ec2:CreateTags", "ec2:DeleteTags",
        ]
        Resource  = "*"
        Condition = { StringEquals = { "aws:ResourceTag/Project" = local.project } }
      },
      {
        Sid    = "BatchManageProject"
        Effect = "Allow"
        Action = [
          "batch:CreateComputeEnvironment", "batch:UpdateComputeEnvironment", "batch:DeleteComputeEnvironment",
          "batch:CreateJobQueue", "batch:UpdateJobQueue", "batch:DeleteJobQueue",
          "batch:RegisterJobDefinition", "batch:DeregisterJobDefinition", "batch:TagResource", "batch:UntagResource",
        ]
        Resource = [
          "arn:aws:batch:${var.region}:${local.account_id}:compute-environment/amr-*",
          "arn:aws:batch:${var.region}:${local.account_id}:job-queue/amr-*",
          "arn:aws:batch:${var.region}:${local.account_id}:job-definition/amr-*",
        ]
      },
      {
        Sid      = "BatchRead"
        Effect   = "Allow"
        Action   = ["batch:DescribeComputeEnvironments", "batch:DescribeJobQueues", "batch:DescribeJobDefinitions", "batch:ListTagsForResource", "batch:ListJobs"]
        Resource = "*"
      },
      {
        Sid    = "ProjectLogGroup"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy",
          "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource", "logs:TagLogGroup",
        ]
        Resource = ["arn:aws:logs:${var.region}:${local.account_id}:log-group:/amr/batch", "arn:aws:logs:${var.region}:${local.account_id}:log-group:/amr/batch:*"]
      },
      {
        Sid      = "LogsRead"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = "*"
      },
      {
        # The roles themselves live in platform/ (batch_roles.tf); the deployer only hands them
        # to Batch (instance profile in the compute environment, job role in job definitions).
        Sid      = "PassBatchRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [local.instance_role_arn, local.job_role_arn]
      },
      {
        Sid      = "ComputeState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::${local.state_bucket}/compute/*"
      },
      {
        Sid      = "ReadPlatformState"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "arn:aws:s3:::${local.state_bucket}/platform/*"
      },
      {
        Sid      = "ListStateBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::${local.state_bucket}"
      },
    ]
  })
}
