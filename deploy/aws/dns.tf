# Optional: if you manage app_domain in Route53, set hosted_zone_id and this
# creates the A record to the Elastic IP. Otherwise create the A record manually
# at your DNS provider (Phase 5), pointing app_domain at the aws_eip output.
resource "aws_route53_record" "app" {
  count = var.hosted_zone_id == "" ? 0 : 1

  zone_id = var.hosted_zone_id
  name    = var.app_domain
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}
