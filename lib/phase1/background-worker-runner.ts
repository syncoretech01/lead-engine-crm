import { drainNotifyOutbox } from "@/lib/growth/notify-outbox";
import { runLeadJobWorkerTick } from "@/lib/phase1/lead-job-worker-runner";
import { runProviderWorkerTick } from "@/lib/phase1/provider-worker-runner";
import { runRecordingWorkerTick } from "@/lib/phase1/recording-worker-runner";
import { runSdrDailyReportWorkerTick } from "@/lib/phase1/sdr-daily-report-worker";

export type BackgroundWorkerTickOptions = {
  workspaceId?: string;
  maxRuns?: number;
  workerId?: string;
  shouldStop?: () => boolean;
};

export type BackgroundWorkerDependencies = {
  runProvider: typeof runProviderWorkerTick;
  runLead: typeof runLeadJobWorkerTick;
  runRecording: typeof runRecordingWorkerTick;
  runDailyReports: typeof runSdrDailyReportWorkerTick;
  drainNotify: typeof drainNotifyOutbox;
};

const productionDependencies: BackgroundWorkerDependencies = {
  runProvider: runProviderWorkerTick,
  runLead: runLeadJobWorkerTick,
  runRecording: runRecordingWorkerTick,
  runDailyReports: runSdrDailyReportWorkerTick,
  drainNotify: drainNotifyOutbox
};

/** One production tick, injectable only so the existing worker lanes stay regression-tested. */
export async function runBackgroundWorkerTick(
  options: BackgroundWorkerTickOptions = {},
  dependencies: BackgroundWorkerDependencies = productionDependencies
) {
  const provider = await dependencies.runProvider({
    workspaceId: options.workspaceId,
    maxLiveRuns: options.maxRuns,
    workerId: options.workerId
  });
  const lead = await dependencies.runLead({
    workspaceId: options.workspaceId,
    maxRuns: options.maxRuns,
    workerId: options.workerId
  });
  const recording = await dependencies.runRecording({ workspaceId: options.workspaceId });
  const dailyReports = await dependencies.runDailyReports({ workspaceId: options.workspaceId });
  const notify = await dependencies.drainNotify({
    workspaceId: options.workspaceId,
    workerId: options.workerId,
    shouldStop: options.shouldStop
  });

  return { provider, lead, recording, dailyReports, notify };
}

/** Abort wakes the loop immediately; it never aborts an in-flight delivery. */
export async function waitForBackgroundWorkerInterval(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
