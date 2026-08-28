resource "aws_instance" "app" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = var.instance_type
  subnet_id                   = element(tolist(data.aws_subnets.default.ids), 0)
  vpc_security_group_ids      = [aws_security_group.web.id]
  key_name                    = var.key_pair_name
  iam_instance_profile        = aws_iam_instance_profile.instance.name
  associate_public_ip_address = true

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  # Static bootstrap: installs Node 22 + Caddy + a swapfile, and writes
  # /etc/syncore/{web,worker}.env from SSM. It reads region from IMDS and uses
  # the fixed SSM prefix, so no templating is required. App build/deploy is a
  # separate step (deploy-app.sh) run after provisioning.
  user_data                   = file("${path.module}/user-data.sh")
  user_data_replace_on_change = false

  # The AMI comes from an SSM parameter AWS republishes every few weeks. Without
  # this, ANY future apply — however unrelated — plans to destroy and recreate
  # the only production instance (losing the git checkout, the syncore-contracts
  # sibling build, swap, and Caddy's TLS state until a manual re-bootstrap).
  # OS refreshes should be a deliberate act: remove this line for one apply, or
  # taint the instance, when an AMI upgrade is actually intended.
  lifecycle {
    ignore_changes = [ami]
  }

  # Ensure SSM params + RDS exist before the instance boots and reads them.
  depends_on = [
    aws_db_instance.main,
    aws_ssm_parameter.database_url,
    aws_ssm_parameter.config,
  ]

  tags = { Name = "syncore-app" }
}

resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id
}
