import { estimatedProviderCostCents, evaluateBudgetStopRules } from "@/lib/phase1/money";
import { completeProviderJobRun, failProviderJobRun } from "@/lib/phase1/provider-jobs";
import { resolveProviderSecret } from "@/lib/phase1/provider-secret-vault";
import type { AppState, ProviderConnection, ProviderJob, ProviderJobRun } from "@/lib/phase1/types";
import { getLiveProviderOperation } from "@/lib/providers/live-adapters";
import { providerConfig } from "@/lib/providers/registry";
import type { ProviderCredential, ProviderId, ProviderRequestContext, ProviderResult } from "@/lib/providers/types";
import type { ProviderWorkerExecutionResult } from "@/lib/phase1/provider-worker";

const defaultRetryDelayMs = 60_000;

export type LiveProviderRunPlan = {
  runId: string;
  workspaceId: string;
  providerId: ProviderId;
  operation: string;
  input: unknown;
  context: ProviderRequestContext;
};

export type LiveProviderPlanResult =
  | { ok: true; plan: LiveProviderRunPlan }
  | { ok: false; result: ProviderWorkerExecutionResult };

export type LiveAdapterOutcome =
  | { kind: "missing-adapter"; message: string }
  | { kind: "error"; message: string }
  | { kind: "result"; result: ProviderResult<unknown> };

export type LiveCredentialResult =
  | { ok: true; credential: ProviderCredential }
  | { ok: false; reason: string };

/**
 * Resolve the credential a live adapter needs to authenticate, from the
 * provider connection's configured storage. Runs in the sync plan phase (it
 * needs `state` for the vault) so the decrypted secret can ride the request
 * context into the stateless invoke phase.
 */
export function resolveLiveProviderCredential(
  state: AppState,
  connection: ProviderConnection | undefined,
  env: Record<string, string | undefined> = process.env
): LiveCredentialResult {
  if (!connection) {
    return { ok: false, reason: "No provider connection is configured for live execution." };
  }
  if (!connection.enabled) {
    return { ok: false, reason: "Provider connection is disabled." };
  }

  if (connection.secretStorage === "Encrypted database") {
    if (!connection.secretRef) {
      return { ok: false, reason: "Provider connection has no stored credential." };
    }
    try {
      const secret = resolveProviderSecret(state, connection.secretRef, {
        workspaceId: connection.workspaceId,
        providerId: connection.providerId
      });
      const record = state.providerEncryptedSecrets.find((item) => item.secretRef === connection.secretRef);
      return { ok: true, credential: { source: "vault", secret, keyId: record?.keyId } };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Could not decrypt provider credential." };
    }
  }

  if (connection.secretStorage === "Environment") {
    const envVars = providerConfig(connection.providerId).envVars;
    if (envVars.length === 0) {
      return { ok: false, reason: "Provider has no environment credential configured." };
    }
    const values: Record<string, string> = {};
    const missing: string[] = [];
    for (const name of envVars) {
      const value = env[name]?.trim();
      if (value) values[name] = value;
      else missing.push(name);
    }
    if (missing.length > 0) {
      return { ok: false, reason: `Missing environment credential(s): ${missing.join(", ")}.` };
    }
    const secret = envVars.length === 1 ? values[envVars[0]] : JSON.stringify(values);
    return { ok: true, credential: { source: "environment", secret } };
  }

  return { ok: false, reason: `Unsupported credential storage "${connection.secretStorage}" for live execution.` };
}

function providerConnectionFor(state: AppState, workspaceId: string, providerId: ProviderId) {
  return state.providerConnections.find(
    (connection) => connection.workspaceId === workspaceId && connection.providerId === providerId
  );
}

/**
 * Phase 1 (sync, inside updateState): claim the run for live execution and
 * apply budget stop rules before any network call is made. Returns either a
 * plan to execute out-of-band, or a terminal result (e.g. budget skip).
 */
export function planLiveProviderRun(
  state: AppState,
  runId: string,
  options: { workerId: string; workspaceId?: string; now?: string }
): LiveProviderPlanResult {
  const now = options.now ?? new Date().toISOString();
  const run = providerRunById(state, runId, options.workspaceId);
  const job = providerJobForRun(state, run);

  if (run.status === "Queued") {
    run.status = "Running";
    run.startedAt = run.startedAt ?? now;
    run.lockedBy = options.workerId;
    run.lockedAt = now;
    run.lockExpiresAt = new Date(Date.parse(now) + defaultRetryDelayMs).toISOString();
    run.updatedAt = now;
    job.status = "Running";
    job.startedAt = job.startedAt ?? now;
    job.updatedAt = now;
  } else if (run.status !== "Running") {
    throw new Error("Provider job run must be queued or running for live execution.");
  }

  const estimateCents = estimatedProviderCostCents({
    provider: run.providerId,
    operation: run.operation,
    unitsUsed: 1
  });
  const budget = evaluateBudgetStopRules(state, {
    workspaceId: run.workspaceId,
    providerId: run.providerId,
    leadJobId: job.sourceObjectType === "lead_job" ? job.sourceObjectId : undefined,
    nextCostCents: estimateCents,
    now
  });

  if (!budget.allowed) {
    const reason = budget.stopReason ?? "Provider budget stop rule triggered.";
    skipRun(run, job, reason, now);
    return { ok: false, result: executionResult(run, job, "Skipped", reason) };
  }

  // A live run cannot proceed without a credential — treat a missing or
  // undecryptable secret as a terminal misconfiguration (no retry), so it
  // surfaces immediately rather than failing opaquely at the network call.
  const connection = providerConnectionFor(state, run.workspaceId, run.providerId);
  const credentialResult = resolveLiveProviderCredential(state, connection);
  if (!credentialResult.ok) {
    failProviderJobRun(state, { runId: run.id, workspaceId: run.workspaceId, errorMessage: credentialResult.reason });
    return { ok: false, result: executionResult(run, job, "Failed", credentialResult.reason) };
  }

  return {
    ok: true,
    plan: {
      runId: run.id,
      workspaceId: run.workspaceId,
      providerId: run.providerId,
      operation: run.operation,
      input: run.requestSummary ?? job.inputSummary ?? {},
      context: {
        workspaceId: run.workspaceId,
        providerId: run.providerId,
        executionMode: "live",
        requestId: run.providerRequestId,
        actorUserId: job.createdById,
        credential: credentialResult.credential
      }
    }
  };
}

/**
 * Phase 2 (async, no state mutation): call the registered live adapter. This is
 * the only step that performs network I/O, so it runs outside any state
 * transaction.
 */
export async function invokeLiveProviderAdapter(plan: LiveProviderRunPlan): Promise<LiveAdapterOutcome> {
  const handler = getLiveProviderOperation(plan.providerId, plan.operation);
  if (!handler) {
    return {
      kind: "missing-adapter",
      message: `No live adapter registered for ${plan.providerId}/${plan.operation}.`
    };
  }

  try {
    const result = await handler(plan.input, plan.context);
    return { kind: "result", result };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "Live provider call failed."
    };
  }
}

/**
 * Phase 3 (sync, inside updateState): record the adapter outcome on the run/job
 * and usage ledger (completeProviderJobRun records Actual cost).
 */
export function applyLiveProviderRunOutcome(
  state: AppState,
  runId: string,
  outcome: LiveAdapterOutcome,
  options: { workspaceId?: string; now?: string } = {}
): ProviderWorkerExecutionResult {
  const now = options.now ?? new Date().toISOString();
  const run = providerRunById(state, runId, options.workspaceId);
  const job = providerJobForRun(state, run);

  if (outcome.kind === "missing-adapter") {
    failProviderJobRun(state, { runId, workspaceId: run.workspaceId, errorMessage: outcome.message });
    return executionResult(run, job, "Failed", outcome.message);
  }

  if (outcome.kind === "error" || outcome.result.status === "error") {
    const message =
      outcome.kind === "error" ? outcome.message : outcome.result.errorMessage ?? "Live provider returned an error.";
    const nextRetryAt =
      run.attempt < run.maxAttempts ? new Date(Date.parse(now) + defaultRetryDelayMs).toISOString() : undefined;
    failProviderJobRun(state, { runId, workspaceId: run.workspaceId, errorMessage: message, nextRetryAt });
    return executionResult(run, job, nextRetryAt ? "Retry scheduled" : "Failed", message);
  }

  const result = outcome.result;
  const recordsWritten = result.data.length;
  const unitsUsed = Math.max(recordsWritten, 1);
  const costCents = estimatedProviderCostCents({
    provider: run.providerId,
    operation: run.operation,
    unitsUsed
  });

  completeProviderJobRun(state, {
    runId,
    workspaceId: run.workspaceId,
    recordsRead: Math.max(recordsWritten, result.status === "ok" ? 1 : 0),
    recordsWritten,
    costCents,
    responseSummary: {
      executionMode: "live",
      provider: providerConfig(run.providerId).name,
      operation: run.operation,
      status: result.status,
      warnings: (result.meta.warnings ?? []).join("; ")
    },
    rawResponseRef: `live-provider-response://${run.providerId}/${run.id}`,
    providerRunId: result.meta.requestId ?? `live-${run.providerId}-${run.attempt}`,
    completedAt: now
  });

  return executionResult(run, job, "Completed", `Live ${run.providerId} ${run.operation} returned ${result.status}.`);
}

function skipRun(run: ProviderJobRun, job: ProviderJob, reason: string, now: string) {
  run.status = "Skipped";
  run.errorMessage = reason;
  run.completedAt = now;
  run.lockedBy = undefined;
  run.lockedAt = undefined;
  run.lockExpiresAt = undefined;
  run.updatedAt = now;
  job.status = "Skipped";
  job.errorMessage = reason;
  job.completedAt = now;
  job.updatedAt = now;
}

function executionResult(
  run: ProviderJobRun,
  job: ProviderJob,
  status: ProviderWorkerExecutionResult["status"],
  message: string
): ProviderWorkerExecutionResult {
  return {
    runId: run.id,
    providerJobId: job.id,
    providerId: run.providerId,
    operation: run.operation,
    status,
    recordsRead: run.recordsRead,
    recordsWritten: run.recordsWritten,
    message
  };
}

function providerJobForRun(state: AppState, run: ProviderJobRun) {
  const job = state.providerJobs.find((item) => item.id === run.providerJobId && item.workspaceId === run.workspaceId);
  if (!job) {
    throw new Error("Provider job not found for run.");
  }
  return job;
}

function providerRunById(state: AppState, runId: string, workspaceId?: string) {
  const run = state.providerJobRuns.find((item) => item.id === runId);
  if (!run || (workspaceId && run.workspaceId !== workspaceId)) {
    throw new Error("Provider job run not found.");
  }
  return run;
}
