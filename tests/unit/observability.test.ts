import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureError,
  defaultObservabilitySink,
  recordEvent,
  resetObservabilitySink,
  setObservabilitySink,
  type ObservabilitySink
} from "@/lib/phase1/observability";

afterEach(() => {
  resetObservabilitySink();
  vi.restoreAllMocks();
});

describe("observability seam (P6)", () => {
  it("forwards captureError and recordEvent to the active sink", () => {
    const sink: ObservabilitySink = { captureError: vi.fn(), recordEvent: vi.fn() };
    setObservabilitySink(sink);

    const error = new Error("boom");
    captureError(error, { route: "webhooks/ses" });
    recordEvent("transactional_email_send_failed", { workspaceId: "workspace-a" });

    expect(sink.captureError).toHaveBeenCalledWith(error, { route: "webhooks/ses" });
    expect(sink.recordEvent).toHaveBeenCalledWith("transactional_email_send_failed", { workspaceId: "workspace-a" });
  });

  it("restores the default sink on reset", () => {
    const sink: ObservabilitySink = { captureError: vi.fn(), recordEvent: vi.fn() };
    setObservabilitySink(sink);
    resetObservabilitySink();

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    captureError(new Error("after reset"));
    expect(sink.captureError).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never throws when the sink throws", () => {
    setObservabilitySink({
      captureError: () => {
        throw new Error("sink is down");
      },
      recordEvent: () => {
        throw new Error("sink is down");
      }
    });

    expect(() => captureError(new Error("x"))).not.toThrow();
    expect(() => recordEvent("y")).not.toThrow();
  });

  it("default sink emits structured JSON", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    defaultObservabilitySink.captureError(new Error("kaboom"), { route: "webhooks/ses" });
    defaultObservabilitySink.recordEvent("quarantined", { email: "x@y.com" });

    const errorLine = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(errorLine).toMatchObject({ level: "error", message: "kaboom", route: "webhooks/ses" });

    const eventLine = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(eventLine).toMatchObject({ level: "event", event: "quarantined", email: "x@y.com" });
  });
});
