provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "syncore-lead-engine-crm"
      Env       = "prod"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

# Lean setup: reuse the account's default VPC + its public subnets (no custom
# VPC / NAT gateway). RDS is kept private via security groups, not private subnets.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Amazon Linux 2023, ARM64 (for Graviton t4g), via the AWS-published SSM parameter.
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  app_url = "https://${var.app_domain}"
}
