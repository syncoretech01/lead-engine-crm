import { afterEach, describe, expect, it } from "vitest";
import { resolveSession } from "@/lib/phase1/auth";
import { createProviderJob } from "@/lib/phase1/provider-jobs";
import {
  applyLiveProviderRunOutcome,
  invokeLiveProviderAdapter,
  planLiveProviderRun
} from "@/lib/phase1/provider-live-execution";
import { processProviderJobQueue } from "@/lib/phase1/provider-worker";
import { saveProviderConnectionConfig } from "@/lib/phase1/provider-connections";
import { createSeedState } from "@/lib/phase1/seed";
import { registerLiveProviderAdapter, resetLiveProviderAdapters } from "@/lib/providers/live-adapters";
import type { ProviderConnection } from "@/lib/phase1/types";

type SeedState = ReturnType<typeof createSeedState>;

function adminSession(state: SeedState) {
  return resolveSession(state, { userId: "user-nora", workspaceId: state.workspaces[0].id });
}

function configureZeroBounce(
  state: SeedState,
  session: ReturnType<typeof adminSession>,
  overrides: Partial<ProviderConnection> = {}
): ProviderConnection {
  saveProviderConnectionConfig(state, session, {
    providerId: "zerobounce",
    enabled: true,
    secretValue: "zb-secret",
    allowedOperations: ["verify_email"]
  });
  const connection = state.providerConnections.find(
    (item) => item.providerId === "zerobounce" && item.workspaceId === session.workspace.id
  );
  if (!connection) {
    throw new Error("Expected a ZeroBounce provider connection to be configured.");
  }
  Object.assign(connection, overrides);
  return connection;
}

describe("live provider execution", () => {
  afterEach(() => resetLiveProviderAdapters());

  it("runs a live adapter end-to-end and records actual usage", async () => {
    const state = createSeedState();
    const session = adminSession(state);
    configureZeroBounce(state, session, { executionMode: "live" });
    let receivedCredential: string | undefined;
    registerLiveProviderAdapter({
      id: "zerobounce",
      operations: {
        verify_email: async (_input, context) => {
          receivedCredential = context.credential?.secret;
          return {
            status: "ok",
            data: [
              { email: "a@b.com", status: "valid", grade: "A", reasonCodes: [], checkedAt: "2026-01-01T00:00:00.000Z" }
            ],
            meta: { providerId: "zerobounce", requestId: context.requestId }
          };
        }
      }
    });

    const { run } = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: { email: "a@b.com" }
    });

    const plan = planLiveProviderRun(state, run.id, { workerId: "live-worker", workspaceId: session.workspace.id });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // The decrypted vault secret rides the plan context into the adapter.
    expect(plan.plan.context.credential).toEqual({ source: "vault", secret: "zb-secret", keyId: expect.any(String) });

    const outcome = await invokeLiveProviderAdapter(plan.plan);
    expect(outcome.kind).toBe("result");
    expect(receivedCredential).toBe("zb-secret");

    const result = applyLiveProviderRunOutcome(state, run.id, outcome, { workspaceId: session.workspace.id });
    expect(result.status).toBe("Completed");
    expect(run.status).toBe("Completed");
    expect(
      state.providerUsageLedger.some((entry) => entry.providerJobRunId === run.id && entry.amountKind === "Actual")
    ).toBe(true);
  });

  it("fails the run when no live adapter is registered", async () => {
    const state = createSeedState();
    const session = adminSession(state);
    configureZeroBounce(state, session, { executionMode: "live" });

    const { run } = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: { email: "c@d.com" }
    });

    const plan = planLiveProviderRun(state, run.id, { workerId: "live-worker", workspaceId: session.workspace.id });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const outcome = await invokeLiveProviderAdapter(plan.plan);
    expect(outcome.kind).toBe("missing-adapter");

    const result = applyLiveProviderRunOutcome(state, run.id, outcome, { workspaceId: session.workspace.id });
    expect(result.status).toBe("Failed");
    expect(run.status).toBe("Failed");
  });

  it("fails a live run whose connection has no credential", () => {
    const state = createSeedState();
    const session = adminSession(state);
    configureZeroBounce(state, session, { executionMode: "live", secretRef: undefined, secretStorage: "Not configured" });

    const { run } = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: { email: "k@l.com" }
    });

    const plan = planLiveProviderRun(state, run.id, { workerId: "live-worker", workspaceId: session.workspace.id });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.result.status).toBe("Failed");
    expect(run.status).toBe("Failed");
  });

  it("skips a live run that would exceed the provider daily budget", () => {
    const state = createSeedState();
    const session = adminSession(state);
    configureZeroBounce(state, session, { executionMode: "live", dailyBudgetCents: 0 });

    const { run } = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: { email: "e@f.com" }
    });

    const plan = planLiveProviderRun(state, run.id, { workerId: "live-worker", workspaceId: session.workspace.id });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.result.status).toBe("Skipped");
    expect(run.status).toBe("Skipped");
  });

  it("defers runs that exceed the provider per-minute rate limit", () => {
    const state = createSeedState();
    const session = adminSession(state);
    configureZeroBounce(state, session, { rateLimitPerMinute: 1 });

    const first = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: { email: "g@h.com" }
    });
    const second = createProviderJob(state, session, {
      providerId: "zerobounce",
      operation: "verify_email",
      inputSummary: { email: "i@j.com" }
    });

    const tick = processProviderJobQueue(state, { workerId: "mock-worker", workspaceId: session.workspace.id });
    expect(tick.completed).toBe(1);
    expect(tick.deferred).toBe(1);

    const statuses = [first.run.status, second.run.status];
    expect(statuses.filter((status) => status === "Completed")).toHaveLength(1);
    expect(statuses.filter((status) => status === "Queued")).toHaveLength(1);
  });
});
