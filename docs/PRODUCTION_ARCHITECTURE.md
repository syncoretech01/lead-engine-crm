# Syncore Production Architecture

Last updated: 2026-06-09

This document locks the target production stack for Syncore Lead Engine & CRM. The current app remains a local MVP with provider simulations and snapshot-first persistence; these decisions define what we will connect as we harden the product.

## Target Stack

| Layer | Decision | Implementation status |
|---|---|---|
| Frontend/app | Next.js, React, TypeScript | In place |
| Styling | Syncore custom SaaS UI system, with Tailwind-compatible utilities where useful | In place as custom CSS |
| Backend | Next.js server actions and API routes first; split workers/services only when needed | In place locally |
| Primary database | PostgreSQL with Prisma | Schema and projection mirror in place; normalized reads still pending |
| App hosting | Vercel for simplest launch, or AWS App Runner/ECS for AWS-native launch | Not connected |
| Worker compute | Managed worker platform, ECS/Fargate, or EC2 for long-running jobs | Not connected |
| Queue/cache | Redis plus a worker runner | Not connected |
| Object storage | S3-compatible storage for recordings, CSV exports, attachments, and provider payload archives | Not connected |
| Telephony/SMS | RingCentral | Local placeholder updated to `RingCentral Local`; real API integration pending |
| Phone validation | Dedicated lookup/verification provider if RingCentral does not cover validation needs | Not connected |
| Email sending | Dedicated ESP such as Resend, Postmark, or SendGrid | Local provider only |
| Auth | Clerk/Auth0/OIDC-compatible identity provider | Demo cookie/env session only |
| Search | PostgreSQL search first; OpenSearch only when lead search volume requires it | Deferred |
| Analytics warehouse | PostgreSQL reports first; ClickHouse only when event/report scale requires it | Deferred |
| Observability | Sentry plus structured logs; OpenTelemetry/Datadog/Grafana when services split | Not connected |
| Billing | Stripe Billing when multi-tenant subscriptions are needed | Not connected |

## RingCentral Scope

RingCentral is the preferred production provider for telephony and SMS. It should own:

- outbound and inbound voice calls
- outbound and inbound SMS
- call status webhooks
- SMS delivery, reply, failure, and opt-out webhooks
- call recording metadata and recording links where the account plan permits it
- CRM activity creation from call/SMS events
- suppression side effects from STOP/opt-out events

RingCentral should not be treated as the only data-quality provider. Phone normalization exists locally; production phone validation may still require a dedicated lookup provider.

## AWS EC2 Scope

EC2 is optional, not the default app-hosting requirement. It is useful when Syncore needs lower-level server control:

- long-running extraction/enrichment workers
- browser automation or scraping workers for sanctioned sources only
- webhook relay or internal integration services
- self-hosted queue/search/analytics experiments before moving to managed services
- bastion access to private AWS resources

For the main web app, prefer Vercel for speed or AWS App Runner/ECS for an AWS-native setup. For files, use S3 rather than EC2 disk storage.

## Deferred Scale Services

OpenSearch/Elasticsearch, ClickHouse, Kafka, Kubernetes, Terraform, and full OpenTelemetry are not first-launch requirements. Add them when one of these is true:

- PostgreSQL queries cannot meet lead search latency targets.
- Reporting/event volume becomes expensive or slow in PostgreSQL.
- Provider jobs need durable distributed coordination beyond Redis workers.
- The infrastructure footprint grows beyond a single app plus workers.

## Implementation Order

1. Continue Prisma/PostgreSQL hardening by cutting low-risk reads from snapshot state to normalized tables.
2. Add production auth and signed sessions.
3. Add Redis-backed workers for extraction, enrichment, verification, exports, and webhook side effects.
4. Connect RingCentral behind the existing SMS/call event interfaces.
5. Add S3-compatible storage for recordings, exports, and attachments.
6. Connect the selected email provider and provider-native email webhooks.
7. Add observability, deployment environments, backups, and incident runbooks.
8. Add search/analytics infrastructure only when measured volume justifies it.

## Manual Inputs Needed Later

The user does not need to provide anything for the current architecture-lock step. Later manual tasks will include:

- creating production PostgreSQL and storage resources
- choosing the auth provider account
- creating a RingCentral developer app and supplying credentials
- choosing the email provider and setting DNS records
- creating S3 bucket credentials or AWS IAM roles
- completing legal/privacy review before live outbound sending
