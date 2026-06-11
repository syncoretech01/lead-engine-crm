# Provider Integration Plan

Updated: 2026-06-10

This plan defines the selected provider strategy only. It does not add live provider calls.

## Selected Providers

| Provider | Role | Production Use |
|---|---|---|
| Apollo | Primary B2B lead source | Company/contact discovery for standard B2B outbound lists. |
| Google Places | Local business source | Local business discovery, location data, phone/website signals. |
| Apify | Controlled custom extraction source | Sanctioned, bounded custom extraction when no official data source covers the niche. |
| Hunter | Email finder and secondary verifier | Email discovery and backup verification for contacts. |
| ZeroBounce | Primary email verification | Email deliverability grading, bounce risk, catch-all/risky classification. |
| Lusha | Email/phone fallback provider | Fallback contact details when Apollo/Hunter/PDL are incomplete. |
| People Data Labs | Person/company enrichment fallback | Company/person enrichment and profile normalization. |
| Twilio Lookup | Phone validation | Phone number format, carrier, line type, and validity checks. |
| Smartlead | Cold email sender | Campaign sending, reply/bounce/open/click/unsubscribe sync. |
| Amazon SES | Transactional app email | Application notifications, passwordless/login/admin system email if needed. |

## Integration Principles

- Provider adapters must implement typed interfaces in `lib/providers`.
- Provider credentials must be workspace-scoped and encrypted at rest.
- Server-side code is the only place where provider secrets may be read.
- UI flows should show provider connection status, not raw secrets.
- Each provider call must produce a job/run record, raw response reference, normalized result, and audit trail.
- Retries must be idempotent by workspace, provider, provider record ID, and operation.
- Real provider adapters should be added behind feature flags or disabled-by-default configuration.

## Initial Rollout Order

1. Credential storage and provider connection testing.
2. ZeroBounce email verification adapter.
3. Hunter email finder adapter.
4. Apollo lead source adapter.
5. Google Places local source adapter.
6. Twilio Lookup phone validation adapter.
7. People Data Labs enrichment fallback adapter.
8. Lusha fallback contact data adapter.
9. Smartlead outbound sync adapter.
10. Amazon SES transactional email adapter.
11. Apify controlled custom extraction adapter.

## Non-Goals For The Current Stabilization Pass

- No network calls.
- No provider SDK installation.
- No real API key validation.
- No live webhook provider signature implementation.
- No sending email, SMS, or calls.
