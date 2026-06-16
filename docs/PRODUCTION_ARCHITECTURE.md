# Syncore Production Architecture

Last updated: 2026-06-16

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
| Phone validation | Twilio Lookup | Mock provider registry only |
| Cold outbound email | Smartlead | Mock provider registry only |
| Transactional app email | Amazon SES | Mock provider registry only |
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

RingCentral should not be treated as the phone validation provider. Phone normalization exists locally; production phone validation should use Twilio Lookup before phone-ready exports, SMS sends, or calling workflows.

## Email Scope

Smartlead is the selected production provider for cold outbound campaign sending and reply/bounce/unsubscribe sync. Amazon SES is the selected production provider for transactional application email such as invites, login/admin messages, and system notifications.

Smartlead and Amazon SES should remain separate integration lanes:

- Smartlead owns prospecting campaign email and outreach engagement events.
- Amazon SES owns product/system email and provider-native delivery/bounce/complaint webhooks.
- Neither provider should receive suppressed contacts or records that fail Syncore verification gates.

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
4. Connect Twilio Lookup behind the phone validation interface.
5. Connect RingCentral behind the existing SMS/call event interfaces.
6. Add S3-compatible storage for recordings, exports, attachments, and provider payload archives.
7. Connect Smartlead cold outbound sync and webhooks.
8. Connect Amazon SES transactional email and webhooks.
9. Add observability, deployment environments, backups, and incident runbooks.
10. Add search/analytics infrastructure only when measured volume justifies it.

## Manual Inputs Needed Later

The user does not need to provide anything for the current architecture-lock step. Later manual tasks will include:

- creating production PostgreSQL and storage resources
- choosing the auth provider account
- creating a RingCentral developer app and supplying credentials
- creating Twilio credentials with Lookup access
- creating a Smartlead account and supplying API credentials
- creating an Amazon SES identity and completing DNS verification
- creating S3 bucket credentials or AWS IAM roles
- completing legal/privacy review before live outbound sending
