import { prisma } from "../lib/prisma";
import { syncNormalizedProjectionToPrisma } from "../lib/phase1/persistence-projection";
import { createSeedState } from "../lib/phase1/seed";

async function main() {
  const state = createSeedState();
  const result = await syncNormalizedProjectionToPrisma(
    state,
    prisma as unknown as Parameters<typeof syncNormalizedProjectionToPrisma>[1]
  );
  const writeSnapshot =
    process.argv.includes("--snapshot") ||
    process.env.SYNCORE_SEED_SNAPSHOT?.toLowerCase() === "true";

  if (writeSnapshot) {
    await prisma.appStateSnapshot.upsert({
      where: { id: "syncore-primary-state" },
      update: {
        version: state.version,
        state: state as never
      },
      create: {
        id: "syncore-primary-state",
        version: state.version,
        state: state as never
      }
    });
  }

  console.log("Seeded normalized Prisma tables for Syncore.");
  console.log(`Projection hash: ${result.hash}`);
  console.log(`Synced tables: ${result.syncedTables.length}`);
  console.log(`Skipped tables: ${result.skippedTables.length}`);
  console.log(`Snapshot written: ${writeSnapshot ? "yes" : "no"}`);
  console.log(`Projection table count keys: ${Object.keys(result.tables).length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
