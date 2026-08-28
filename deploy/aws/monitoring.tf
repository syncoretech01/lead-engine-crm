# Cheapest effective alert set for this footprint (one EC2 + one RDS, no agents).
# The July OOM and August swap-death were both detected by a human — EC2 status
# checks stayed "ok" through the latter. These three alarms + the worker's
# dead-man heartbeat (SYNCORE_WORKER_HEARTBEAT_URL, code already shipped) are the
# signals that would have fired.
#
# Everything here is gated on var.alert_email: leave it empty and this file
# creates nothing (safe to merge, deliberate to activate). The email subscription
# must be confirmed from the inbox once after the first apply.

resource "aws_sns_topic" "alerts" {
  count = var.alert_email == "" ? 0 : 1
  name  = "syncore-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# The box is unreachable or the OS is wedged. Two consecutive minutes, because a
# single failed probe happens on healthy instances.
resource "aws_cloudwatch_metric_alarm" "ec2_status" {
  count               = var.alert_email == "" ? 0 : 1
  alarm_name          = "syncore-app-status-check-failed"
  alarm_description   = "EC2 status checks failing on syncore-app (box unreachable or OS wedged)."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

# The db.t4g.micro has ~1GB; sustained low freeable memory is the precursor to
# connection failures and swap-death on the DB side.
resource "aws_cloudwatch_metric_alarm" "rds_memory" {
  count               = var.alert_email == "" ? 0 : 1
  alarm_name          = "syncore-rds-freeable-memory-low"
  alarm_description   = "RDS freeable memory under 100MB for 10 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 100 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

# A full RDS volume stops every write in the app. The blob write path grows the
# database faster than row counts suggest, so alert with real runway left.
resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  count               = var.alert_email == "" ? 0 : 1
  alarm_name          = "syncore-rds-free-storage-low"
  alarm_description   = "RDS free storage under 2GB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}
