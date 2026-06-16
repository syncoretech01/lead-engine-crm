import { describe, expect, it, vi } from "vitest";
import contractFixtures from "@/tests/fixtures/providers/provider-contracts.json";
import {
  assertProviderFixtureIsRedacted,
  providerConfig,
  runProviderContractFixture,
  supportedProviders,
  type ProviderContractFixture
} from "@/lib/providers";

const fixtures = contractFixtures as ProviderContractFixture[];

describe("provider adapter contract fixtures", () => {
  it("has at least one fixture for every selected provider", () => {
    const fixtureProviderIds = new Set(fixtures.map((fixture) => fixture.providerId));

    for (const provider of supportedProviders()) {
      expect(fixtureProviderIds.has(provider.id), `missing fixture for ${provider.id}`).toBe(true);
    }
  });

  it("keeps fixture payloads redacted and capability-aligned", () => {
    const fixtureIds = new Set<string>();

    for (const fixture of fixtures) {
      expect(fixtureIds.has(fixture.id), `duplicate fixture id ${fixture.id}`).toBe(false);
      fixtureIds.add(fixture.id);
      expect(fixture.mode).toMatch(/^(mock-fixture|recorded-fixture)$/);
      expect(fixture.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(providerConfig(fixture.providerId).capabilities).toContain(fixture.operation);
      expect(() => assertProviderFixtureIsRedacted(fixture)).not.toThrow();
    }
  });

  it("runs every fixture through the no-network mock adapter contract", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("Provider contract tests must not call the network.");
    });
    vi.stubGlobal("fetch", fetchSpy);

    for (const fixture of fixtures) {
      await expect(
        runProviderContractFixture(fixture, {
          workspaceId: "workspace-syncore",
          executionMode: "mock",
          requestId: `contract-${fixture.id}`,
          actorUserId: "user-nora"
        })
      ).resolves.toMatchObject({
        status: fixture.expected.status,
        meta: {
          providerId: fixture.providerId,
          requestId: `contract-${fixture.id}`
        }
      });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
