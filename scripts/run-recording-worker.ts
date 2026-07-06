import { runRecordingWorkerTick } from "@/lib/phase1/recording-worker-runner";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

/**
 * Standalone recording-reconcile worker. In prod this tick is folded into the
 * background worker (scripts/run-background-worker.ts); this entrypoint exists to
 * run it in isolation for testing.
 *
 *   npm run worker:recording                    # single tick
 *   npm run worker:recording -- --loop 30000     # tick every 30s
 */
function parseArgs(argv: string[]) {
  const args: { loopMs?: number; workspaceId?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--loop") args.loopMs = Number(argv[++i]);
    else if (arg === "--workspace") args.workspaceId = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Recording worker starting (driver=${resolveStorageDriver()}${args.loopMs ? `, loop=${args.loopMs}ms` : ", single tick"}).`
  );

  const tick = async () => {
    const result = await runRecordingWorkerTick({ workspaceId: args.workspaceId });
    console.log(`[${new Date().toISOString()}] scanned=${result.scanned} matched=${result.matched} updated=${result.updated}`);
  };

  if (!args.loopMs) {
    await tick();
    return;
  }

  let stopping = false;
  process.on("SIGINT", () => {
    console.log("\nStopping after current tick…");
    stopping = true;
  });

  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      console.error(`Tick error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, args.loopMs));
  }
}

main()
  .catch((error) => {
    console.error(`Recording worker failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (resolveStorageDriver() === "prisma") {
        const { prisma } = await import("@/lib/prisma");
        await prisma.$disconnect();
      }
    } catch {
      // best-effort
    }
  });
