import { runProviderWorkerTick, type ProviderWorkerTick } from "@/lib/phase1/provider-worker-runner";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

/**
 * Out-of-band provider worker entrypoint. Designed to be driven by a hosted
 * cron/scheduler (one tick per invocation). Pass --loop <ms> to self-drive
 * locally for testing.
 *
 *   npm run worker:provider                    # single tick
 *   npm run worker:provider -- --loop 15000     # tick every 15s
 *   npm run worker:provider -- --workspace <id> --max 10
 */
function parseArgs(argv: string[]) {
  const args: { loopMs?: number; workspaceId?: string; maxLiveRuns?: number; workerId?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--loop") args.loopMs = Number(argv[++i]);
    else if (arg === "--workspace") args.workspaceId = argv[++i];
    else if (arg === "--max") args.maxLiveRuns = Number(argv[++i]);
    else if (arg === "--worker-id") args.workerId = argv[++i];
  }
  return args;
}

function logTick(tick: ProviderWorkerTick) {
  const m = tick.mock;
  console.log(
    `[${new Date().toISOString()}] mock: claimed=${m.claimed} completed=${m.completed} failed=${m.failed} deferred=${m.deferred} retried=${m.retried} recovered=${m.recovered} | live: executed=${tick.live.executed}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tickOptions = { workspaceId: args.workspaceId, maxLiveRuns: args.maxLiveRuns, workerId: args.workerId };
  console.log(`Provider worker starting (driver=${resolveStorageDriver()}${args.loopMs ? `, loop=${args.loopMs}ms` : ", single tick"}).`);

  if (!args.loopMs) {
    logTick(await runProviderWorkerTick(tickOptions));
    return;
  }

  let stopping = false;
  process.on("SIGINT", () => {
    console.log("\nStopping after current tick…");
    stopping = true;
  });

  while (!stopping) {
    try {
      logTick(await runProviderWorkerTick(tickOptions));
    } catch (error) {
      console.error(`Tick error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, args.loopMs));
  }
}

main()
  .catch((error) => {
    console.error(`Provider worker failed: ${error instanceof Error ? error.message : String(error)}`);
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
