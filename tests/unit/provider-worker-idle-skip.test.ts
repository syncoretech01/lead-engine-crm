import { describe, expect, it } from "vitest";

import { hasClaimableProviderRun } from "@/lib/phase1/provider-worker-runner";
import type { AppState } from "@/lib/phase1/types";

function stateWith(runs: Array<{ status: string; workspaceId: string }>): AppState {
  return { providerJobRuns: runs } as unknown as AppState;
}

describe("hasClaimableProviderRun (provider worker idle-skip)", () => {
  it("is false with no runs, or when none are Queued (worker can skip its writes)", () => {
    expect(hasClaimableProviderRun(stateWith([]))).toBe(false);
    expect(
      hasClaimableProviderRun(
        stateWith([
          { status: "Completed", workspaceId: "w1" },
          { status: "Running", workspaceId: "w1" },
          { status: "Failed", workspaceId: "w1" }
        ])
      )
    ).toBe(false);
  });

  it("is true when any run is Queued (there is work to do)", () => {
    expect(
      hasClaimableProviderRun(stateWith([{ status: "Completed", workspaceId: "w1" }, { status: "Queued", workspaceId: "w1" }]))
    ).toBe(true);
  });

  it("scopes to a workspace when one is given", () => {
    const runs = [
      { status: "Queued", workspaceId: "w1" },
      { status: "Completed", workspaceId: "w2" }
    ];
    expect(hasClaimableProviderRun(stateWith(runs), "w1")).toBe(true);
    expect(hasClaimableProviderRun(stateWith(runs), "w2")).toBe(false);
  });
});
