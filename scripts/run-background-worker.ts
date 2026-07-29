import {
  runBackgroundWorkerTick,
  waitForBackgroundWorkerInterval
} from "@/lib/phase1/background-worker-runner";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { pingWorkerHeartbeat } from "@/lib/phase1/worker-heartbeat";

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

async function runTick(args: BackgroundWorkerArgs, shouldStop?: () => boolean) {
  const { provider, lead, recording, dailyReports, notify } = await runBackgroundWorkerTick({
    workspaceId: args.workspaceId,
    maxRuns: args.maxRuns,
    workerId: args.workerId,
    shouldStop
  });

  console.log(
    `[${new Date().toISOString()}] provider-mock=${provider.mock.completed}/${provider.mock.claimed} provider-live=${provider.live.executed} lead-jobs=${lead.completed}/${lead.claimed} failed=${lead.failed} recordings=${recording.updated}/${recording.scanned} daily-reports=${dailyReports.created} notify=${notify.delivered}/${notify.claimed} notify-failed=${notify.failed} notify-dead=${notify.deadLettered} notify-pending=${notify.remaining}`
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
  const shutdown = new AbortController();
  const requestStop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    console.log(`\n${signal} received; stopping after current delivery...`);
    stopping = true;
    shutdown.abort();
  };
  const onSigint = () => requestStop("SIGINT");
  const onSigterm = () => requestStop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    while (!stopping) {
      try {
        await runTick(args, () => stopping);
        await pingWorkerHeartbeat(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Tick error: ${message}`);
        await pingWorkerHeartbeat(false, message);
      }
      if (stopping) break;
      await waitForBackgroundWorkerInterval(args.loopMs, shutdown.signal);
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
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
