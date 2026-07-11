import { afterAll, describe, expect, it } from "vitest";

/**
 * Write-seq CAS — concurrency correctness (blob-migration Phase 0).
 *
 * The AppStateSnapshot is a single row that every write reads-modifies-writes.
 * Before the compare-and-set, two concurrent updateState transactions both read
 * the same snapshot and the second commit silently overwrote the first — a lost
 * update. These tests exercise the real path against Postgres and assert that
 * concurrent writes all survive (the loser retries against fresh state).
 *
 * Only runs when SYNCORE_RUN_DB_INTEGRATION=1 (CI `integration` job / the local
 * docker-compose.dev.yml loop); otherwise skipped so the unit lane needs no DB.
 */
const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";
const SNAPSHOT_ID = "syncore-primary-state";

async function readWriteSeq() {
  const { prisma } = await import("@/lib/prisma");
  const row = await prisma.appStateSnapshot.findUniqueOrThrow({
    where: { id: SNAPSHOT_ID },
    select: { writeSeq: true }
  });
  return row.writeSeq;
}

describe.skipIf(!enabled)("AppState write-seq CAS (concurrency)", () => {
  process.env.SYNCORE_STORAGE_DRIVER = "prisma";

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });

  it("does not lose a concurrent write (no last-write-wins)", async () => {
    const { resetStore, readState, updateAuthState, appendAudit } = await import("@/lib/phase1/store");
    const { getDemoSession } = await import("@/lib/phase1/auth");

    await resetStore();
    const initial = await readState();
    const session = getDemoSession(initial);
    const before = initial.auditLogs.length;

    // Two mutations that both read the same snapshot and each append a distinct
    // audit row, fired concurrently. Without CAS the second commit clobbers the
    // first; with CAS the loser retries and both survive.
    await Promise.all([
      updateAuthState((state) => appendAudit(state, session, { objectType: "test", objectId: "cas-A", action: "concurrent_a" }), {
        normalizedTables: ["auditLogs"]
      }),
      updateAuthState((state) => appendAudit(state, session, { objectType: "test", objectId: "cas-B", action: "concurrent_b" }), {
        normalizedTables: ["auditLogs"]
      })
    ]);

    const after = await readState();
    const objectIds = after.auditLogs.map((entry) => entry.objectId);
    expect(objectIds).toContain("cas-A");
    expect(objectIds).toContain("cas-B");
    expect(after.auditLogs.length).toBe(before + 2);
  });

  it("advances writeSeq exactly once per committed write and persists every row", async () => {
    const { resetStore, readState, updateAuthState, appendAudit } = await import("@/lib/phase1/store");
    const { getDemoSession } = await import("@/lib/phase1/auth");
    const { prisma } = await import("@/lib/prisma");

    await resetStore();
    const session = getDemoSession(await readState());
    const before = (await readState()).auditLogs.length;
    const seq0 = await readWriteSeq();

    const burst = 6;
    await Promise.all(
      Array.from({ length: burst }, (_, index) =>
        updateAuthState((state) => appendAudit(state, session, { objectType: "test", objectId: `burst-${index}`, action: "cas_burst" }), {
          normalizedTables: ["auditLogs"]
        })
      )
    );

    // writeSeq advanced by exactly `burst` — retries don't double-count (only the
    // committing transaction bumps it), and nothing was lost.
    expect((await readWriteSeq()) - seq0).toBe(burst);

    // Every burst row landed in both the blob and the normalized projection.
    const after = await readState();
    expect(after.auditLogs.filter((entry) => entry.action === "cas_burst").length).toBe(burst);
    expect(after.auditLogs.length).toBe(before + burst);
    expect(await prisma.auditLog.count({ where: { action: "cas_burst" } })).toBe(burst);
  });
});
