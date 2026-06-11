# Secrets And Credentials Plan

Updated: 2026-06-10

## API Key Storage

Provider API keys should be stored per workspace and per provider connection. The database should store metadata such as provider ID, status, scopes, last tested time, creator/updater, and encrypted secret references. Raw API keys should never be stored in plaintext.

## Encrypted Secrets

Production should use envelope encryption:

- Application-level encryption before database write, or a managed secret store.
- A KMS-managed master key or equivalent.
- Secret versioning for rotation.
- Separate read/write permissions for credential management and provider execution.

## Environment Variables

Environment variables may hold infrastructure-level defaults and local development placeholders. They should not become the long-term storage mechanism for customer/workspace provider credentials.

Examples:

- `DATABASE_URL`
- `SYNCORE_STORAGE_DRIVER`
- provider fallback placeholders for local development
- encryption/KMS configuration

## Workspace-Level Provider Config

Each workspace should be able to configure provider connections independently:

- Provider enabled/disabled status
- Credential secret reference
- Allowed operations such as extract, verify, enrich, send, or webhook sync
- Rate limits and daily budget limits
- Default waterfall position
- Last health check and error summary

## Provider Connection Testing

Connection tests must run server-side only. A test should verify that the credential is present, has expected scopes, and can reach the provider when real adapters are enabled. In local/no-op mode, tests should validate only configuration shape.

Connection test results should store:

- Provider ID
- Workspace ID
- Status
- Checked at timestamp
- Checked by user
- Redacted error summary
- Raw provider response reference if needed

## Frontend Secret Safety

Secrets must never be exposed to frontend components, client bundles, logs, analytics, or browser-accessible API responses. UI should display only:

- Connected/disconnected state
- Last tested timestamp
- Credential label or masked suffix
- Provider scopes
- Redacted error messages

## Audit Logs

Credential lifecycle events must write audit logs:

- Credential created
- Credential tested
- Credential rotated
- Credential disabled
- Credential deleted
- Provider scopes changed
- Provider execution paused/resumed

Audit records should include actor, workspace, provider, action, timestamp, and redacted metadata only.
