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

  // The ops-script path: readState → mutate in memory (for minutes, in real use) →
  // writeState. Before the CAS this silently overwrote whatever committed in
  // between; now it must refuse, loudly, and the interleaved write must survive.
  it("writeState of a previously-read state refuses to clobber a concurrent commit", async () => {
    const { resetStore, readState, writeState, updateAuthState, appendAudit } = await import("@/lib/phase1/store");
    const { getDemoSession } = await import("@/lib/phase1/auth");

    await resetStore();
    const stale = await readState(); // the "script" reads…
    const session = getDemoSession(stale);

    // …and while it mutates in memory, a user action commits.
    await updateAuthState(
      (state) => appendAudit(state, session, { objectType: "test", objectId: "interleaved-user-action", action: "cas_interleave" }),
      { normalizedTables: ["auditLogs"] }
    );

    await expect(writeState(stale)).rejects.toThrow(/changed while this script was running/);

    const after = await readState();
    expect(after.auditLogs.some((entry) => entry.objectId === "interleaved-user-action")).toBe(true);
  });

  it("a clean writeState commits via CAS and advances writeSeq once", async () => {
    const { resetStore, readState, writeState } = await import("@/lib/phase1/store");

    await resetStore();
    const seq0 = await readWriteSeq();
    const current = await readState();
    await writeState(current);
    expect(await readWriteSeq()).toBe(seq0 + 1);
  });

  // Provisioning-style writes hand writeState a state that was never read, so there
  // is nothing to compare against — but the write must still bump writeSeq so any
  // concurrent CAS writer whose baseline predates it conflicts instead of silently
  // reverting the whole write.
  it("a writeState of never-read state still advances writeSeq", async () => {
    const { resetStore, writeState } = await import("@/lib/phase1/store");
    const { createSeedState } = await import("@/lib/phase1/seed");

    await resetStore();
    const seq0 = await readWriteSeq();
    await writeState(createSeedState());
    expect(await readWriteSeq()).toBe(seq0 + 1);
  });
});
