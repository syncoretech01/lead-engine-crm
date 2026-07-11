import { afterAll, describe, expect, it } from "vitest";

/**
 * Projection diff mode == full mode (blob-migration Phase 0).
 *
 * `diff` mode upserts only the rows a scoped write changed, instead of re-upserting
 * every row of the scoped tables. It is now the default, so this proves it produces
 * an identical projection to `full` for the same mutation — covering both an ADD
 * (new audit rows) and a MODIFY (a changed contact field, which diff must NOT skip).
 *
 * Only runs when SYNCORE_RUN_DB_INTEGRATION=1 (CI `integration` job / local
 * docker-compose.dev.yml); otherwise skipped so the unit lane needs no DB.
 */
const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";

describe.skipIf(!enabled)("projection diff mode equals full mode", () => {
  process.env.SYNCORE_STORAGE_DRIVER = "prisma";
  const originalMode = process.env.SYNCORE_PROJECTION_MODE;

  afterAll(async () => {
    if (originalMode === undefined) {
      delete process.env.SYNCORE_PROJECTION_MODE;
    } else {
      process.env.SYNCORE_PROJECTION_MODE = originalMode;
    }
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });

  async function applyAndSnapshot(mode: "full" | "diff") {
    process.env.SYNCORE_PROJECTION_MODE = mode;
    const { resetStore, readState, updateAuthState, appendAudit } = await import("@/lib/phase1/store");
    const { getDemoSession } = await import("@/lib/phase1/auth");
    const { prisma } = await import("@/lib/prisma");

    await resetStore();
    const seed = await readState();
    const session = getDemoSession(seed);
    const workspaceId = session.workspace.id;
    const targetContact = seed.contacts.find((contact) => contact.workspaceId === workspaceId);
    if (!targetContact) throw new Error("seed state has no contact to modify");

    // ADD — two audit rows via a scoped auditLogs write.
    await updateAuthState(
      (state) => {
        appendAudit(state, session, { objectType: "test", objectId: "equiv-1", action: "equiv" });
        appendAudit(state, session, { objectType: "test", objectId: "equiv-2", action: "equiv" });
      },
      { normalizedTables: ["auditLogs"] }
    );

    // MODIFY — bump a contact's score via a scoped contacts write. This is the
    // changed-row upsert path that diff mode must detect and not skip.
    await updateAuthState(
      (state) => {
        const contact = state.contacts.find((entry) => entry.id === targetContact.id);
        if (contact) contact.score = 99;
      },
      { normalizedTables: ["contacts"] }
    );

    const audits = await prisma.auditLog.findMany({
      where: { workspaceId, action: "equiv" },
      select: { objectId: true },
      orderBy: { objectId: "asc" }
    });
    const projected = await prisma.contact.findUnique({ where: { id: targetContact.id }, select: { score: true } });
    return { auditObjectIds: audits.map((entry) => entry.objectId), targetScore: projected?.score };
  }

  it("full and diff produce identical projected rows for the same mutation", async () => {
    const full = await applyAndSnapshot("full");
    const diff = await applyAndSnapshot("diff");

    expect(diff).toEqual(full);
    expect(diff.auditObjectIds).toEqual(["equiv-1", "equiv-2"]);
    expect(diff.targetScore).toBe(99);
  });
});
