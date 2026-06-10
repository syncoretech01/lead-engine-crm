import { describe, expect, it } from "vitest";
import { runRetentionPolicy } from "@/lib/phase1/reporting";
import { createSeedState } from "@/lib/phase1/seed";

describe("retention workflows", () => {
  it("previews and applies call recording anonymization for records older than the policy TTL", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const policy = state.retentionPolicies.find((item) => item.dataType === "Call recordings");
    const call = state.trackedCalls.find((item) => item.recordingUrl || item.transcript);

    expect(policy).toBeDefined();
    expect(call).toBeDefined();
    if (!policy || !call) return;

    call.createdAt = "2024-01-01T00:00:00.000Z";
    const preview = runRetentionPolicy(state, workspaceId, policy.id, "Preview", state.users[0].id);
    const applied = runRetentionPolicy(state, workspaceId, policy.id, "Apply", state.users[0].id);
    const updatedCall = state.trackedCalls.find((item) => item.id === call.id);

    expect(preview.candidateCount).toBeGreaterThan(0);
    expect(preview.affectedCount).toBe(0);
    expect(applied.status).toBe("Applied");
    expect(applied.affectedCount).toBeGreaterThan(0);
    expect(updatedCall?.recordingUrl).toBeUndefined();
    expect(updatedCall?.transcript).toBeUndefined();
  });
});
