# Spot-only Batch: scales to zero when idle, capped at var.max_vcpus.

# Project log group (not Batch's default /aws/batch/job, which Batch re-creates on its own
# and would then block the next apply). Jobs send logs here via their logConfiguration.
resource "aws_cloudwatch_log_group" "batch" {
  #checkov:skip=CKV_AWS_158:Default CloudWatch encryption is sufficient; KMS adds cost
  #checkov:skip=CKV_AWS_338:Job logs are only for debugging a run; 7 days keeps them cheap
  name              = local.log_group
  retention_in_days = 7
}

resource "aws_launch_template" "batch" {
  name = "amr-batch"

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 100
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  metadata_options {
    http_tokens = "required"
    # 1 = only the host reaches instance metadata; containers use their own job role.
    http_put_response_hop_limit = 1
    http_endpoint               = "enabled"
  }

  # Batch requires MIME multipart user data. Installs a self-contained AWS CLI (Miniforge + conda
  # awscli, as Nextflow's docs recommend, both pinned; the installer is checked against its
  # published SHA-256) into /opt/aws-cli. Nextflow mounts it into every task
  # container; being self-contained (own Python and libz) it runs even in minimal images such as
  # Shovill's, where AWS's official CLI build fails for lack of libz. If the install fails, the
  # instance shuts down so Batch replaces it instead of running every job on a broken host.
  user_data = base64encode(<<-EOT
    MIME-Version: 1.0
    Content-Type: multipart/mixed; boundary="==BOUNDARY=="

    --==BOUNDARY==
    Content-Type: text/x-shellscript; charset="us-ascii"

    #!/bin/bash
    set -euo pipefail
    trap 'echo "AWS CLI install failed; shutting down so Batch replaces this host"; shutdown -h now' ERR
    cd /tmp
    curl -sSfL --retry 5 --retry-all-errors --connect-timeout 10 \
      "https://github.com/conda-forge/miniforge/releases/download/${local.miniforge_version}/Miniforge3-${local.miniforge_version}-Linux-x86_64.sh" -o miniforge.sh
    echo "${local.miniforge_sha256}  miniforge.sh" | sha256sum -c -
    bash miniforge.sh -b -p ${local.aws_cli_dir}
    ${local.aws_cli_dir}/bin/conda install -y -q -c conda-forge awscli=${local.awscli_version}
    ${local.aws_cli_dir}/bin/conda clean -y -a
    ${local.aws_cli_dir}/bin/aws --version
    rm -f miniforge.sh

    --==BOUNDARY==--
    EOT
  )

  tag_specifications {
    resource_type = "volume"
    tags          = local.tags
  }
}

resource "aws_batch_compute_environment" "spot" {
  name         = "amr-spot"
  type         = "MANAGED"
  state        = "ENABLED"
  service_role = null # use the AWSServiceRoleForBatch service-linked role

  compute_resources {
    type                = "SPOT"
    allocation_strategy = "SPOT_PRICE_CAPACITY_OPTIMIZED"
    min_vcpus           = 0
    desired_vcpus       = 0
    max_vcpus           = var.max_vcpus
    instance_type       = var.instance_families
    instance_role       = local.instance_profile_arn
    subnets             = aws_subnet.public[*].id
    security_group_ids  = [aws_security_group.batch.id]
    tags                = local.tags

    ec2_configuration {
      image_type = "ECS_AL2023"
    }

    launch_template {
      launch_template_id = aws_launch_template.batch.id
      version            = aws_launch_template.batch.latest_version
    }
  }

  lifecycle {
    ignore_changes = [compute_resources[0].desired_vcpus]
  }

  # Destroy order: instances (and their last log lines) go before the log group.
  depends_on = [aws_cloudwatch_log_group.batch]
}

resource "aws_batch_job_queue" "main" {
  name     = local.queue_name
  state    = "ENABLED"
  priority = 1

  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.spot.arn
  }
}

# Smoke test: proves network, IAM, the host AWS CLI mount and S3 access end to end.
resource "aws_batch_job_definition" "smoke" {
  name                  = "amr-smoke"
  type                  = "container"
  propagate_tags        = true
  platform_capabilities = ["EC2"]

  retry_strategy {
    attempts = 2
  }
  timeout {
    attempt_duration_seconds = 600
  }

  container_properties = jsonencode({
    image      = "public.ecr.aws/amazonlinux/amazonlinux:2023"
    jobRoleArn = local.job_role_arn
    command = [
      "/bin/sh", "-c",
      "echo \"smoke ok $(date -u +%FT%TZ)\" | ${local.aws_cli_dir}/bin/aws s3 cp - s3://${local.bucket_name}/smoke/$AWS_BATCH_JOB_ID.txt",
    ]
    resourceRequirements = [
      { type = "VCPU", value = "1" },
      { type = "MEMORY", value = "1024" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.batch.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "amr"
      }
    }
    volumes     = [{ name = "awscli", host = { sourcePath = local.aws_cli_dir } }]
    mountPoints = [{ sourceVolume = "awscli", containerPath = local.aws_cli_dir, readOnly = true }]
  })
}
