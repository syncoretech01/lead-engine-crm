output "instance_public_ip" {
  description = "Elastic IP of the app instance. Point app_domain here (Phase 5) if not using Route53."
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  description = "EC2 instance id (use with: aws ssm start-session --target <id>)."
  value       = aws_instance.app.id
}

output "rds_endpoint" {
  description = "RDS endpoint host (already baked into the DATABASE_URL SSM param)."
  value       = aws_db_instance.main.address
}

output "s3_bucket" {
  description = "App S3 bucket name (exports/backups)."
  value       = aws_s3_bucket.app.bucket
}

output "ssm_prefix" {
  description = "SSM prefix where config lives and where you must add the app secrets."
  value       = var.ssm_prefix
}

output "db_password" {
  description = "Generated RDS master password (also stored in the DATABASE_URL SSM param)."
  value       = random_password.db.result
  sensitive   = true
}
