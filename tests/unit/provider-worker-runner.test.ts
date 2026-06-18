import { afterEach, describe, expect, it } from "vitest";
import { resolveSession } from "@/lib/phase1/auth";
import { createProviderJob } from "@/lib/phase1/provider-jobs";
import { saveProviderConnectionConfig } from "@/lib/phase1/provider-connections";
import { collectDueLiveProviderPlans } from "@/lib/phase1/provider-worker-runner";
import { createSeedState } from "@/lib/phase1/seed";
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
  if (!connection) throw new Error("Expected a ZeroBounce connection.");
  Object.assign(connection, { executionMode: "live", ...overrides });
  return connection;
}

function queueVerifyJob(state: SeedState, session: ReturnType<typeof adminSession>, email: string) {
  return createProviderJob(state, session, {
    providerId: "zerobounce",
    operation: "verify_email",
    inputSummary: { email }
  });
}

describe("collectDueLiveProviderPlans", () => {
  const originalFlag = process.env.SYNCORE_ENABLE_LIVE_PROVIDERS;
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.SYNCORE_ENABLE_LIVE_PROVIDERS;
    else process.env.SYNCORE_ENABLE_LIVE_PROVIDERS = originalFlag;
  });

  it("claims and plans queued live runs with the credential attached", () => {
    process.env.SYNCORE_ENABLE_LIVE_PROVIDERS = "true";
    const state = createSeedState();
    const session = adminSession(state);
    configureZeroBounce(state, session);
    const { run } = queueVerifyJob(state, session, "a@b.com");

    const { plans } = collectDueLiveProviderPlans(state, { workerId: "w", workspaceId: session.workspace.id });

    expect(plans).toHaveLength(1);
    expect(plans[0].runId).toBe(run.id);
    expect(plans[0].context.credential?.secret).toBe("zb-secret");
    expect(run.status).toBe("Running");
  });

  it("ignores runs whose connection is not in live mode", () => {
    process.env.SYNCORE_ENABLE_LIVE_PROVIDERS = "true";
    const state = createSeedState();
    const session = adminSession(state);
    configureZeroBounce(state, session, { executionMode: "mock" });
    queueVerifyJob(state, session, "a@b.com");

    const { plans } = collectDueLiveProviderPlans(state, { workerId: "w", workspaceId: session.workspace.id });
    expect(plans).toHaveLength(0);
  });

  it("ignores live runs when the global live flag is off", () => {
    delete process.env.SYNCORE_ENABLE_LIVE_PROVIDERS;
    const state = createSeedState();
    const session = adminSession(state);
    configureZeroBounce(state, session);
    queueVerifyJob(state, session, "a@b.com");

    const { plans } = collectDueLiveProviderPlans(state, { workerId: "w", workspaceId: session.workspace.id });
    expect(plans).toHaveLength(0);
  });

  it("defers a live run that exceeds the per-minute rate limit", () => {
    process.env.SYNCORE_ENABLE_LIVE_PROVIDERS = "true";
    const state = createSeedState();
    const session = adminSession(state);
    configureZeroBounce(state, session, { rateLimitPerMinute: 1 });

    const first = queueVerifyJob(state, session, "a@b.com");
    first.run.status = "Completed";
    first.run.updatedAt = new Date().toISOString();
    const second = queueVerifyJob(state, session, "c@d.com");

    const { plans } = collectDueLiveProviderPlans(state, { workerId: "w", workspaceId: session.workspace.id });
    expect(plans).toHaveLength(0);
    expect(second.run.status).toBe("Queued");
  });
});
