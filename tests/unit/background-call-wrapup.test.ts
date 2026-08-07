import { describe, expect, it, vi } from "vitest";

import {
  backgroundCallWrapupError,
  launchBackgroundCallWrapup
} from "@/components/crm/cockpit/focus/background-call-wrapup";

describe("background call wrap-up", () => {
  it("advances synchronously before the save request settles", async () => {
    const events: string[] = [];
    let resolveRequest: ((value: { ok: true }) => void) | undefined;
    const request = new Promise<{ ok: true }>((resolve) => {
      resolveRequest = resolve;
    });

    const launched = launchBackgroundCallWrapup({
      request: () => {
        events.push("request-started");
        return request;
      },
      onStarted: () => events.push("next-lead"),
      onSuccess: () => events.push("saved"),
      onFailure: (error) => events.push(`failed:${error}`)
    });

    expect(launched).toBe(true);
    expect(events).toEqual(["request-started", "next-lead"]);

    resolveRequest?.({ ok: true });
    await request;
    await Promise.resolve();
    expect(events).toEqual(["request-started", "next-lead", "saved"]);
  });

  it("reports a server-declared failure after advancing", async () => {
    const onFailure = vi.fn();
    launchBackgroundCallWrapup({
      request: async () => ({ ok: false, error: "Write failed" }),
      onStarted: vi.fn(),
      onSuccess: vi.fn(),
      onFailure
    });

    await Promise.resolve();
    expect(onFailure).toHaveBeenCalledWith("Write failed");
  });

  it("does not advance when the request cannot be launched", () => {
    const onStarted = vi.fn();
    const onFailure = vi.fn();
    const launched = launchBackgroundCallWrapup({
      request: () => {
        throw new Error("Offline");
      },
      onStarted,
      onSuccess: vi.fn(),
      onFailure
    });

    expect(launched).toBe(false);
    expect(onStarted).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith("Offline");
  });

  it("normalizes unknown errors", () => {
    expect(backgroundCallWrapupError(null)).toBe("Could not save the wrap-up.");
  });
});
