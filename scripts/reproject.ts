import { syncNormalizedProjectionToPrisma } from "@/lib/phase1/persistence-projection";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { readState } from "@/lib/phase1/store";

/**
 * Rebuild every normalized projection table from the canonical AppStateSnapshot
 * blob. Used during the AWS migration (Phase 2): after restoring just the
 * AppStateSnapshot row into a fresh RDS database, this repopulates all ~74
 * relational tables in one pass — avoiding cross-table FK/enum ordering issues
 * from dumping every table.
 *
 * Requires SYNCORE_STORAGE_DRIVER=prisma and DATABASE_URL pointing at the target
 * database. Idempotent: it does a full delete-then-upsert sync, so re-running is
 * safe. The snapshot row must already exist in the target DB.
 */
async function main() {
  if (resolveStorageDriver() !== "prisma") {
    throw new Error("reproject requires SYNCORE_STORAGE_DRIVER=prisma and a DATABASE_URL.");
  }

  const { prisma } = await import("@/lib/prisma");
  try {
    const state = await readState();
    const result = await prisma.$transaction(
      (tx) =>
        syncNormalizedProjectionToPrisma(
          state,
          tx as unknown as Parameters<typeof syncNormalizedProjectionToPrisma>[1],
          {}
        ),
      { maxWait: 15_000, timeout: 120_000 }
    );

    const counts = result.tables ?? {};
    const tableCount = Object.keys(counts).length;
    const rowCount = Object.values(counts).reduce((sum, n) => sum + (n as number), 0);
    console.log(`reproject complete: ${rowCount} rows across ${tableCount} tables.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("reproject failed:", error);
  process.exit(1);
});
