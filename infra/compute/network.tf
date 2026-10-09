# Dedicated VPC with public subnets only. No NAT gateway (idle cost); instances get a
# public IP to reach ENA and container registries, and accept no inbound traffic.

data "aws_availability_zones" "available" {
  #checkov:skip=CKV_AWS_394:Subnets use the first three zones by name; new zones sort after them, so the set does not change
  state = "available"
}

resource "aws_vpc" "main" {
  #checkov:skip=CKV2_AWS_11:VPC flow logs add CloudWatch cost; instances accept no inbound traffic
  #checkov:skip=CKV2_AWS_12:The default security group is never used (Batch uses amr-batch) and the VPC is destroyed after each run; adopting it would require letting the deployer modify untagged security groups
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "amr-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "amr-igw" }
}

resource "aws_subnet" "public" {
  #checkov:skip=CKV_AWS_130:Public IPs replace a NAT gateway; the security group blocks all inbound traffic
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 4, count.index)
  map_public_ip_on_launch = true
  tags                    = { Name = "amr-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "amr-public" }
}

resource "aws_route_table_association" "public" {
  count          = 3
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "batch" {
  #checkov:skip=CKV_AWS_382:Jobs download reads from ENA and images from public registries on many hosts
  name        = "amr-batch"
  description = "Batch instances: no inbound, all outbound"
  vpc_id      = aws_vpc.main.id
  ingress     = []
  egress {
    description = "Downloads: ENA reads, container images, AWS APIs"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "amr-batch" }
}
