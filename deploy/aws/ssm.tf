# Terraform manages the DB URL (assembled from the generated password) and the
# NON-secret app config. The real app SECRETS (auth/webhook/credential/unsubscribe
# keys, provider API keys, SES keys, mailing address, outreach from/reply-to) are
# added OUT-OF-BAND (see README Phase 1 step) under the same prefix, so they never
# enter Terraform state. The instance's user-data pulls the whole prefix at boot.

locals {
  managed_config = {
    SYNCORE_STORAGE_DRIVER                   = "prisma"
    SYNCORE_PROJECTION_MODE                  = "diff"
    SYNCORE_APP_URL                          = local.app_url
    AWS_SES_REGION                           = var.region
    SYNCORE_ENABLE_LIVE_PROVIDERS            = "true"
    SYNCORE_WORKER_LOOP_MS                   = "300000"
    SYNCORE_ALLOW_FILE_STORAGE_IN_PRODUCTION = "false"
    SYNCORE_SEED_SNAPSHOT                    = "false"
    SYNCORE_SES_QUARANTINE_UNSCOPED          = "true"
  }
}

resource "aws_ssm_parameter" "config" {
  for_each = local.managed_config

  name  = "${var.ssm_prefix}/${each.key}"
  type  = "String"
  value = each.value
}

resource "aws_ssm_parameter" "database_url" {
  name  = "${var.ssm_prefix}/DATABASE_URL"
  type  = "SecureString"
  value = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${var.db_name}?sslmode=require"
}

# SES->SNS topic allow-list. Only written when configured — SSM rejects empty String
# values, and an unset param is exactly what makes the webhook fail closed in prod
# (see var.ses_topic_arns and isAllowedSnsTopic). Set var.ses_topic_arns when you
# wire SES->SNS to start accepting bounce/complaint notifications again.
resource "aws_ssm_parameter" "ses_topic_arns" {
  count = var.ses_topic_arns != "" ? 1 : 0

  name  = "${var.ssm_prefix}/SYNCORE_SES_TOPIC_ARNS"
  type  = "String"
  value = var.ses_topic_arns
}
