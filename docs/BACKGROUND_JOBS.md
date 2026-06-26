# Background Jobs

Syncore keeps request/response paths fast by queueing heavy work and running it out of band.

## What Is Backgrounded

- CSV upload now stores raw rows, creates an async job run, and returns immediately.
- The lead job worker normalizes rows, verifies contacts, detects duplicates, runs local enrichment, completes idempotency records, and writes worker audit logs.
- Provider extraction remains handled by the existing provider worker.

## Commands

Run one lead-job worker tick:

```bash
npm run worker:lead
```

Run one combined provider + lead-job tick:

```bash
npm run worker:background
```

Run locally in a loop:

```bash
npm run worker:background -- --loop 15000
```

Limit to one workspace or a small batch:

```bash
npm run worker:lead -- --workspace workspace-syncore-outbound --max 1
```

## Production Scheduling

Use a hosted cron/worker service to call `npm run worker:background` on an interval. Start with every 1 to 5 minutes, then tune based on import volume.

The worker is session-less and uses normalized write-table sync so Prisma-backed production only writes the tables touched by job processing.

For the EC2 setup, see [EC2_WORKER_SETUP.md](EC2_WORKER_SETUP.md).

## Operational Notes

- CSV uploads should show as queued first, then move to running/completed after the worker tick.
- Idempotency prevents duplicate CSV uploads from creating duplicate raw rows or duplicate completed imports.
- Failed CSV worker runs are marked failed after max attempts, with a short retry delay for retryable attempts.
- No real provider calls are added by this worker. Provider jobs still follow the provider worker/live adapter controls.
