import { runLeadJobWorkerTick } from "@/lib/phase1/lead-job-worker-runner";
import { runProviderWorkerTick } from "@/lib/phase1/provider-worker-runner";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

type BackgroundWorkerArgs = {
  loopMs?: number;
  workspaceId?: string;
  maxRuns?: number;
  workerId?: string;
};

function parseArgs(argv: string[]) {
  const args: BackgroundWorkerArgs = {};
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

async function runTick(args: BackgroundWorkerArgs) {
  const provider = await runProviderWorkerTick({
    workspaceId: args.workspaceId,
    maxLiveRuns: args.maxRuns,
    workerId: args.workerId
  });
  const lead = await runLeadJobWorkerTick({
    workspaceId: args.workspaceId,
    maxRuns: args.maxRuns,
    workerId: args.workerId
  });

  console.log(
    `[${new Date().toISOString()}] provider-mock=${provider.mock.completed}/${provider.mock.claimed} provider-live=${provider.live.executed} lead-jobs=${lead.completed}/${lead.claimed} failed=${lead.failed}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Background worker starting (driver=${resolveStorageDriver()}${args.loopMs ? `, loop=${args.loopMs}ms` : ", single tick"}).`);

  if (!args.loopMs) {
    await runTick(args);
    return;
  }

  let stopping = false;
  process.on("SIGINT", () => {
    console.log("\nStopping after current tick...");
    stopping = true;
  });

  while (!stopping) {
    try {
      await runTick(args);
    } catch (error) {
      console.error(`Tick error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, args.loopMs));
  }
}

main()
  .catch((error) => {
    console.error(`Background worker failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await disconnectPrisma();
    } catch {
      // best-effort
    }
  });
