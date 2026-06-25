# Performance Instrumentation

This app now emits structured server-side timing logs for the slowest production paths. The goal is to measure before changing architecture.

## Enable In Vercel

Set these environment variables in Vercel when diagnosing latency:

```env
SYNCORE_PERF_LOGS=true
SYNCORE_PERF_SLOW_MS=500
```

Recommended settings:

- Normal production: `SYNCORE_PERF_LOGS=false`, `SYNCORE_PERF_SLOW_MS=2500`
- Debugging slow pages/actions: `SYNCORE_PERF_LOGS=true`, `SYNCORE_PERF_SLOW_MS=500`

Logs are emitted as single-line JSON prefixed with:

```text
[syncore:perf]
```

## What Is Timed

- `workspace.context`: page-level workspace/session context load.
- `state.requestContext`: request-local state/session bundle shared by the app shell and page render.
- `state.read`: full app state read.
- `state.prisma.snapshotRead`: Prisma snapshot row read.
- `state.update`: server action mutation transaction.
- `state.authUpdate`: auth/system mutation transaction.
- `state.prisma.snapshotUpsert`: snapshot write.
- `projection.create`: in-memory normalized projection build.
- `projection.sync.deleteMany`: stale-row cleanup for selected projection tables.
- `projection.sync.upsert`: normalized row upserts.
- `projection.sync.total`: complete projection sync.
- `ses.sendEmail`: one SES provider call.
- `ses.campaignBatch`: campaign send batch.
- `ses.directEmailBatch`: SDR direct/bulk send batch.

## How To Read The Logs

Example:

```json
{"name":"state.update","status":"ok","durationMs":4120.4,"thresholdMs":500,"driver":"prisma","tables":"contacts,emailEvents,activities,auditLogs"}
```

Key fields:

- `durationMs`: how long the operation took.
- `driver`: storage mode, usually `prisma` in production.
- `tables`: requested projection tables for the action.
- `selectedRows`: number of normalized rows upserted during projection.
- `recipientCount`: number of email recipients in an SES batch.

## Diagnosis Guide

- Healthy authenticated page renders should share one `state.requestContext` between the root app shell and the page content.
- Slow `workspace.context` + slow `state.read`: page loads are blocked by full snapshot reads.
- Slow `state.prisma.snapshotRead`: database/snapshot size or connection latency is the bottleneck.
- Slow `projection.create`: full in-memory projection creation is too expensive.
- Slow `projection.sync.upsert`: Prisma projection writes are too heavy.
- Slow `ses.sendEmail`: provider/network latency is the bottleneck.
- Slow `ses.directEmailBatch` with many recipients: move bulk sends to a background job.

## Next Optimization Targets

1. Avoid building the full projection when only selected tables changed.
2. Move bulk SES sends to background jobs.
3. Convert CRM/SDR pages to direct Prisma read models.
4. Add pagination and query indexes for event-heavy pages.
