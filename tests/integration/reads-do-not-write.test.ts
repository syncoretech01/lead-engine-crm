import { afterAll, describe, expect, it } from "vitest";

/**
 * Reads stop writing (blob-migration Phase 1, part 1).
 *
 * The identity reconcile (mergePrismaIdentityRows) still runs on every read so
 * callers see the natively-written identity — but it no longer *persists* the blob
 * on read. Previously a benign session-lastSeenAt bump rewrote the whole snapshot on
 * every read (the egress/OOM lineage). This asserts a read surfaces native identity
 * drift (correctness) without writing the snapshot back.
 *
 * Only runs when SYNCORE_RUN_DB_INTEGRATION=1 (CI `integration` job / local
 * docker-compose.dev.yml); otherwise skipped so the unit lane needs no DB.
 */
const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";
const SNAPSHOT_ID = "syncore-primary-state";

describe.skipIf(!enabled)("readState does not persist the identity reconcile", () => {
  process.env.SYNCORE_STORAGE_DRIVER = "prisma";

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });

  it("surfaces native identity drift in-memory but does not write the snapshot", async () => {
    const { resetStore, readState } = await import("@/lib/phase1/store");
    const { prisma } = await import("@/lib/prisma");

    await resetStore();
    // Warm-up read: settle any one-time migrateState re-projection so the snapshot
    // is in steady state before we measure whether a read writes.
    await readState();

    const before = await prisma.appStateSnapshot.findUniqueOrThrow({
      where: { id: SNAPSHOT_ID },
      select: { updatedAt: true, writeSeq: true }
    });

    // Identity drift straight into the native table (as the auth fast path would),
    // NOT via the blob — mergePrismaIdentityRows must surface it on read.
    const user = await prisma.user.findFirstOrThrow();
    const drifted = `${user.name} (drifted)`;
    await prisma.user.update({ where: { id: user.id }, data: { name: drifted } });

    // Correctness: a read reflects the native change (the in-memory merge still runs).
    const state = await readState();
    expect(state.users.find((entry) => entry.id === user.id)?.name).toBe(drifted);

    // Reads stop writing: the snapshot was NOT persisted by the read.
    const after = await prisma.appStateSnapshot.findUniqueOrThrow({
      where: { id: SNAPSHOT_ID },
      select: { updatedAt: true, writeSeq: true }
    });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.writeSeq).toBe(before.writeSeq);
  });
});
