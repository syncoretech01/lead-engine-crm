import { describe, expect, it } from "vitest";

/**
 * Meta-test: proves the integration lane actually ran against a database.
 *
 * Every other file here is `describe.skipIf(!enabled)`, gated on
 * SYNCORE_RUN_DB_INTEGRATION=1, so the DB-free unit lane can ignore them. That
 * gating has a failure mode: if the env var is renamed, moved to a step that does
 * not inherit it, or typo'd in a workflow refactor, every suite skips and the job
 * reports success having verified nothing — the projection round-trip, diff
 * equivalence, write-seq CAS, the financial ledger and the notify outbox all
 * silently stop being checked.
 *
 * This file is deliberately NOT skippable. It runs under
 * vitest.integration.config.ts only (its `include` is tests/integration/**), so
 * the unit lane never sees it.
 */
describe("integration lane", () => {
  it("is armed — SYNCORE_RUN_DB_INTEGRATION is set, so the gated suites really ran", () => {
    expect(
      process.env.SYNCORE_RUN_DB_INTEGRATION,
      "SYNCORE_RUN_DB_INTEGRATION must be \"1\" or every gated integration suite silently skips"
    ).toBe("1");
  });

  it("has a database to talk to", async () => {
    expect(process.env.DATABASE_URL, "DATABASE_URL must be set for the integration lane").toBeTruthy();

    const { prisma } = await import("@/lib/prisma");
    try {
      // A trivial round trip: proves the connection string points at a reachable,
      // migrated database rather than merely being present in the environment.
      const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });
});
