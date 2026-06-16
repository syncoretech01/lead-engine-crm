# Phase 8 - Tenant Isolation

Phase 8 hardens workspace boundaries across ID-based server paths without adding real provider network calls.

## Completed Controls

- Page and API access resolve the active `Session` through the signed auth cookie and current workspace membership.
- Server actions continue to write through `session.workspace.id`; high-risk ID mutations now assert workspace ownership at the domain layer.
- Export downloads use workspace-scoped export lookup, and CSV rendering filters every row by `exportRecord.workspaceId` even if `recordIds` are tampered with.
- Signed webhook endpoints are public at the proxy layer but require a valid HMAC signature and a signed payload `workspaceId`.
- Webhook processing resolves a workspace system actor, verifies workspace existence, and rejects contact, campaign, sequence, or sequence-step IDs from other workspaces.
- Provider credential views, encrypted secrets, credential audits, provider jobs, provider job runs, and provider queue processing remain workspace-scoped.
- Provider job lifecycle services require workspace management permission and pass the active workspace into ID lookups.
- SDR assignment, reminder, reassignment, outreach event, SMS, call, and recording paths verify workspace-scoped records before mutation.
- Generated file paths use `workspaces/{workspaceId}/...` via a shared tenant storage helper.
- Dashboard/read-model helpers touched in this phase resolve related names inside the same workspace to avoid same-ID leakage.

## Tests Added

- Export CSV cannot render another workspace's contact even if the export record contains the foreign contact ID.
- Signed webhook processing rejects a valid actor from Workspace B targeting a Workspace A contact.
- SDR action helpers reject assignment IDs from another workspace.
- Provider job snapshots and lifecycle lookups reject job/run IDs from another workspace.
- Generated file paths stay under a sanitized workspace prefix.

## Provider/Webhook Notes

The current webhook model is intentionally local and signed with `SYNCORE_WEBHOOK_SECRET`. Real providers should not rely on browser sessions. When provider integrations are added, each inbound webhook must resolve workspace from a signed provider-owned reference such as provider account ID, connection ID, campaign ID, or event metadata, then validate that reference against workspace-scoped provider connection records.

## Remaining Production Risks

- Real object storage is not connected yet; future S3/R2/GCS keys must keep the `workspaces/{workspaceId}/...` prefix and enforce tenant-aware signed URL issuance.
- Normalized Prisma tables are workspace-scoped, but future direct Prisma queries must keep workspace filters at the query boundary.
- Webhook provider-specific signature verification will need per-provider secret lookup once real providers are connected.
- Full tenant isolation should be re-run after every new external provider, file attachment, export worker, or admin API is added.
