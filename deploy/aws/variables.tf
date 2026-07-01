variable "region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region. Must match the SES identity region."
}

variable "app_domain" {
  type        = string
  description = "FQDN the app serves on, e.g. app.example.com. Used for Caddy auto-TLS and SYNCORE_APP_URL."
}

variable "ssh_ingress_cidr" {
  type        = string
  description = "Your public IP in CIDR form for SSH, e.g. 203.0.113.4/32. Keep it tight."
}

variable "key_pair_name" {
  type        = string
  description = "Name of an existing EC2 key pair for SSH (create one in the console first)."
}

variable "instance_type" {
  type    = string
  default = "t4g.small"
}

variable "root_volume_gb" {
  type    = number
  default = 30
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_max_allocated_storage" {
  type    = number
  default = 50
}

variable "db_engine_version" {
  type        = string
  default     = "16"
  description = "PostgreSQL major (or major.minor). Verify availability: aws rds describe-db-engine-versions --engine postgres."
}

variable "db_name" {
  type    = string
  default = "syncore"
}

variable "db_username" {
  type    = string
  default = "syncore_admin"
}

variable "ssm_prefix" {
  type        = string
  default     = "/syncore/prod"
  description = "SSM Parameter Store prefix for app config/secrets. MUST match the prefix hardcoded in user-data.sh."
}

variable "hosted_zone_id" {
  type        = string
  default     = ""
  description = "Optional Route53 hosted zone ID for app_domain. If set, an A record to the Elastic IP is created."
}
