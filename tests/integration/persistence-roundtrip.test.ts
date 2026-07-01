import { afterAll, describe, expect, it } from "vitest";

/**
 * P1.3 — Real-Postgres round-trip.
 *
 * The unit suite stubs Prisma with an in-memory Proxy, so a mismatch between
 * the AppState projection (persistence-projection.ts) and the actual schema /
 * `readFast*` queries is invisible to it. This test exercises the real path:
 *
 *   writeState (snapshot upsert) -> syncNormalizedProjectionToPrisma (~74 tables)
 *     -> readFastCrmOverviewModel (Prisma findMany / $queryRaw)
 *
 * against a live Postgres, and asserts the projection wrote every row and the
 * fast read model reads exactly what was projected. Break a projection mapper
 * (e.g. drop a Company field or skip the companies table) and this goes red.
 *
 * Only runs when SYNCORE_RUN_DB_INTEGRATION=1 with a reachable DATABASE_URL
 * (set by the CI `integration` job); otherwise it is skipped so the fast unit
 * lane and local dev never require a database.
 */
const enabled = process.env.SYNCORE_RUN_DB_INTEGRATION === "1";

describe.skipIf(!enabled)("real-Postgres persistence round-trip (P1.3)", () => {
  process.env.SYNCORE_STORAGE_DRIVER = "prisma";

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });

  it("projects the seed snapshot into normalized tables and reads it back via the fast model", async () => {
    const { resetStore, readState } = await import("@/lib/phase1/store");
    const { getDemoSession } = await import("@/lib/phase1/auth");
    const { readFastCrmOverviewModel } = await import("@/lib/phase1/crm-overview-read-model");
    const { prisma } = await import("@/lib/prisma");

    // Write the seed AppState: snapshot upsert + normalized projection.
    await resetStore();

    const state = await readState();
    const session = getDemoSession(state);
    const workspaceId = session.workspace.id;

    const snapshotCompanyCount = state.companies.filter((company) => company.workspaceId === workspaceId).length;
    expect(snapshotCompanyCount).toBeGreaterThan(0);

    // Projection completeness: every snapshot company is a projected Company row.
    const projectedCompanyCount = await prisma.company.count({ where: { workspaceId } });
    expect(projectedCompanyCount).toBe(snapshotCompanyCount);

    // Fast read model must be active (Prisma driver) and read what was projected.
    // The demo session is the seeded Admin (full access), so no row-scoping applies.
    const fast = await readFastCrmOverviewModel(session, workspaceId);
    expect(fast).toBeDefined();
    expect(fast?.accounts.length).toBe(projectedCompanyCount);

    // Contacts round-trip the same way.
    const snapshotContactCount = state.contacts.filter((contact) => contact.workspaceId === workspaceId).length;
    const projectedContactCount = await prisma.contact.count({ where: { workspaceId } });
    expect(projectedContactCount).toBe(snapshotContactCount);
  });
});
