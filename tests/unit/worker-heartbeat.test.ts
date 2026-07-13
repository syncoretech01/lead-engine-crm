import { afterEach, describe, expect, it, vi } from "vitest";
import { pingWorkerHeartbeat } from "@/lib/phase1/worker-heartbeat";

describe("pingWorkerHeartbeat", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a no-op when SYNCORE_WORKER_HEARTBEAT_URL is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await pingWorkerHeartbeat(true, undefined, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pings the base URL on a successful tick", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);
    await pingWorkerHeartbeat(true, undefined, { SYNCORE_WORKER_HEARTBEAT_URL: "https://hc-ping.com/uuid" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe("https://hc-ping.com/uuid");
  });

  it("pings <url>/fail with the error detail on a failed tick (and de-dupes a trailing slash)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);
    await pingWorkerHeartbeat(false, "boom", { SYNCORE_WORKER_HEARTBEAT_URL: "https://hc-ping.com/uuid/" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://hc-ping.com/uuid/fail");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST", body: "boom" });
  });

  it("swallows fetch errors so a monitoring outage never crashes the worker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(
      pingWorkerHeartbeat(true, undefined, { SYNCORE_WORKER_HEARTBEAT_URL: "https://hc-ping.com/uuid" })
    ).resolves.toBeUndefined();
  });
});
