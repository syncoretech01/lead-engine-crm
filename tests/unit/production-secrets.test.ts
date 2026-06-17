import { describe, expect, it } from "vitest";
import { resolveCredentialKeyMaterial } from "@/lib/phase1/provider-secret-vault";
import { webhookSecret } from "@/lib/phase1/webhooks";

describe("production secret guards", () => {
  describe("webhook secret", () => {
    it("uses the configured secret when present", () => {
      expect(webhookSecret({ SYNCORE_WEBHOOK_SECRET: "configured-secret" })).toBe("configured-secret");
    });

    it("falls back to the local secret outside production", () => {
      expect(webhookSecret({ NODE_ENV: "development" })).toBe("syncore-local-webhook-secret");
    });

    it("throws when the secret is missing in production", () => {
      expect(() => webhookSecret({ NODE_ENV: "production" })).toThrow(
        /SYNCORE_WEBHOOK_SECRET is required in production/
      );
    });

    it("allows the local secret during the production build phase", () => {
      expect(
        webhookSecret({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })
      ).toBe("syncore-local-webhook-secret");
    });
  });

  describe("provider credential encryption key", () => {
    it("uses the configured key when present", () => {
      expect(
        resolveCredentialKeyMaterial({ SYNCORE_CREDENTIAL_ENCRYPTION_KEY: "configured-key" })
      ).toBe("configured-key");
    });

    it("falls back to the local key outside production", () => {
      expect(resolveCredentialKeyMaterial({ NODE_ENV: "test" })).toBe(
        "syncore-local-development-credential-key"
      );
    });

    it("throws when the key is missing in production", () => {
      expect(() => resolveCredentialKeyMaterial({ NODE_ENV: "production" })).toThrow(
        /SYNCORE_CREDENTIAL_ENCRYPTION_KEY is required in production/
      );
    });

    it("allows the local key during the production build phase", () => {
      expect(
        resolveCredentialKeyMaterial({ NODE_ENV: "production", npm_lifecycle_event: "build" })
      ).toBe("syncore-local-development-credential-key");
    });
  });
});
