import { runLeadJobWorkerTick, type LeadJobWorkerRunnerOptions } from "@/lib/phase1/lead-job-worker-runner";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

function parseArgs(argv: string[]) {
  const args: LeadJobWorkerRunnerOptions & { loopMs?: number } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--loop") args.loopMs = Number(argv[++i]);
    else if (arg === "--workspace") args.workspaceId = argv[++i];
    else if (arg === "--max") args.maxRuns = Number(argv[++i]);
    else if (arg === "--worker-id") args.workerId = argv[++i];
  }
  return args;
}

async function disconnectPrisma() {
  if (resolveStorageDriver() !== "prisma") {
    return;
  }
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
}

function logTick(tick: Awaited<ReturnType<typeof runLeadJobWorkerTick>>) {
  console.log(
    `[${new Date().toISOString()}] lead-jobs: claimed=${tick.claimed} completed=${tick.completed} failed=${tick.failed} skipped=${tick.skipped}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tickOptions: LeadJobWorkerRunnerOptions = {
    workspaceId: args.workspaceId,
    maxRuns: args.maxRuns,
    workerId: args.workerId
  };
  console.log(`Lead job worker starting (driver=${resolveStorageDriver()}${args.loopMs ? `, loop=${args.loopMs}ms` : ", single tick"}).`);

  if (!args.loopMs) {
    logTick(await runLeadJobWorkerTick(tickOptions));
    return;
  }

  let stopping = false;
  process.on("SIGINT", () => {
    console.log("\nStopping after current tick...");
    stopping = true;
  });

  while (!stopping) {
    try {
      logTick(await runLeadJobWorkerTick(tickOptions));
    } catch (error) {
      console.error(`Tick error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, args.loopMs));
  }
}

main()
  .catch((error) => {
    console.error(`Lead job worker failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await disconnectPrisma();
    } catch {
      // best-effort
    }
  });
