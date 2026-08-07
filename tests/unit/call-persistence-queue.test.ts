import { describe, expect, it } from "vitest";

import { enqueueCallPersistence } from "@/components/call/call-persistence-queue";

describe("call persistence queue", () => {
  it("runs hang-up and wrap writes sequentially", async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueueCallPersistence(async () => {
      events.push("hangup-start");
      await firstGate;
      events.push("hangup-end");
      return "hangup";
    });
    const second = enqueueCallPersistence(async () => {
      events.push("wrap-start");
      return "wrap";
    });

    await Promise.resolve();
    expect(events).toEqual(["hangup-start"]);

    releaseFirst?.();
    await expect(first).resolves.toBe("hangup");
    await expect(second).resolves.toBe("wrap");
    expect(events).toEqual(["hangup-start", "hangup-end", "wrap-start"]);
  });

  it("continues after a failed request", async () => {
    await expect(enqueueCallPersistence(async () => {
      throw new Error("hang-up failed");
    })).rejects.toThrow("hang-up failed");

    await expect(enqueueCallPersistence(async () => "wrap saved")).resolves.toBe("wrap saved");
  });
});
