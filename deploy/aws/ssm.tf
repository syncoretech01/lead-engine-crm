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
