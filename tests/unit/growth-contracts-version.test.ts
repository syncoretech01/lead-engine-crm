import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { NotifyEnvelope, WEBHOOK_REPLAY_WINDOW_SECONDS } from "@syncore/contracts";

const require = createRequire(import.meta.url);

describe("@syncore/contracts consumer pin", () => {
  it("resolves the approved v0.2.1 release", () => {
    const packageJson = JSON.parse(
      readFileSync(require.resolve("@syncore/contracts/package.json"), "utf8")
    ) as { version: string };
    expect(packageJson.version).toBe("0.2.1");
  });

  it("retains the notification contract exports consumed by the CRM", () => {
    expect(NotifyEnvelope).toBeDefined();
    expect(WEBHOOK_REPLAY_WINDOW_SECONDS).toBe(300);
  });
});
