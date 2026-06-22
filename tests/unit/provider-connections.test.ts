import { describe, expect, it, vi } from "vitest";
import { resolveSession } from "@/lib/phase1/auth";
import { resolveProviderSecret } from "@/lib/phase1/provider-secret-vault";
import {
  disableProviderConnection,
  ensureProviderConnectionsForRegistry,
  providerConnectionViewsForWorkspace,
  saveProviderConnectionConfig,
  setProviderExecutionMode,
  testProviderConnectionConfig
} from "@/lib/phase1/provider-connections";
import { createSeedState } from "@/lib/phase1/seed";
import { supportedProviders } from "@/lib/providers";
import type { ProviderCapability } from "@/lib/providers/types";

describe("provider connection management", () => {
  it("backfills missing registry provider connections for an existing workspace", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    // Simulate a workspace created before new providers were added: keep only the first 5.
    const kept = state.providerConnections.filter((connection) => connection.workspaceId === workspaceId).slice(0, 5);
    state.providerConnections = kept;

    const result = ensureProviderConnectionsForRegistry(state, workspaceId);
    const after = state.providerConnections.filter((connection) => connection.workspaceId === workspaceId);

    expect(result.changed).toBe(true);
    expect(after).toHaveLength(supportedProviders().length);
    // every registry provider now has exactly one connection
    expect(new Set(after.map((connection) => connection.providerId)).size).toBe(supportedProviders().length);
    // idempotent
    expect(ensureProviderConnectionsForRegistry(state, workspaceId).changed).toBe(false);
  });

  it("toggles execution mode to live and keeps it across config saves", () => {
    const state = createSeedState();
    const session = resolveSession(state, {});

    const live = setProviderExecutionMode(state, session, "hunter", "live");
    expect(live.executionMode).toBe("live");

    // Saving credentials/config must not silently revert a live connection to mock.
    saveProviderConnectionConfig(state, session, { providerId: "hunter", enabled: true, secretValue: "k" });
    const connection = state.providerConnections.find(
      (item) => item.providerId === "hunter" && item.workspaceId === session.workspace.id
    );
    expect(connection?.executionMode).toBe("live");

    expect(setProviderExecutionMode(state, session, "hunter", "mock").executionMode).toBe("mock");
  });

  it("lists safe provider connection views without secret references", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const views = providerConnectionViewsForWorkspace(state, workspaceId);

    expect(views).toHaveLength(25);
    expect(views[0]).toMatchObject({
      providerId: "apollo",
      status: "Not configured",
      enabled: false,
      hasSecret: false
    });
    expect("secretRef" in views[0]).toBe(false);
  });

  it("saves provider config and records redacted credential audit metadata", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });
    const secretValue = "apollo-secret-value-should-never-persist-1234";

    const view = saveProviderConnectionConfig(state, session, {
      providerId: "apollo",
      enabled: true,
      credentialLabel: "Production Apollo key",
      secretValue,
      scopes: ["people:read", "companies:read", "people:read"],
      allowedOperations: ["discover_companies", "discover_contacts"],
      rateLimitPerMinute: 60,
      dailyBudgetCents: 2500,
      waterfallOrder: 1
    });
    const persisted = state.providerConnections.find((connection) => connection.providerId === "apollo");
    const audit = state.providerCredentialAudits[0];

    expect(view).toMatchObject({
      providerId: "apollo",
      status: "Connected",
      enabled: true,
      hasSecret: true,
      credentialLabel: "Production Apollo key",
      maskedSecretSuffix: "1234"
    });
    expect("secretRef" in view).toBe(false);
    expect(persisted?.secretRef).toMatch(/^syncore-secret:\/\/workspace-syncore\/apollo\/v1\//);
    expect(persisted?.secretVersion).toBe(1);
    expect(persisted?.scopes).toEqual(["people:read", "companies:read"]);
    expect(state.providerEncryptedSecrets).toHaveLength(1);
    expect(state.providerEncryptedSecrets[0]).toMatchObject({
      workspaceId: "workspace-syncore",
      providerConnectionId: persisted?.id,
      providerId: "apollo",
      secretRef: persisted?.secretRef,
      secretVersion: 1,
      storage: "Encrypted database",
      algorithm: "aes-256-gcm"
    });
    expect(state.providerEncryptedSecrets[0].ciphertext).not.toContain(secretValue);
    expect(resolveProviderSecret(state, persisted?.secretRef ?? "", {
      workspaceId: "workspace-syncore",
      providerId: "apollo"
    })).toBe(secretValue);
    expect(audit).toMatchObject({
      providerId: "apollo",
      action: "Created",
      secretVersion: 1
    });
    expect(JSON.stringify(state)).not.toContain(secretValue);
    expect(JSON.stringify(audit.redactedMetadata)).not.toContain(secretValue);
  });

  it("rotates encrypted provider secrets and preserves versioned secret references", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });

    saveProviderConnectionConfig(state, session, {
      providerId: "hunter",
      enabled: true,
      secretValue: "hunter-secret-v1"
    });
    const firstRef = state.providerConnections.find((connection) => connection.providerId === "hunter")?.secretRef;

    saveProviderConnectionConfig(state, session, {
      providerId: "hunter",
      enabled: true,
      secretValue: "hunter-secret-v2"
    });

    const persisted = state.providerConnections.find((connection) => connection.providerId === "hunter");
    expect(persisted?.secretVersion).toBe(2);
    expect(persisted?.secretRef).not.toBe(firstRef);
    expect(state.providerEncryptedSecrets).toHaveLength(2);
    expect(state.providerEncryptedSecrets[1].rotatedFromSecretRef).toBe(firstRef);
    expect(resolveProviderSecret(state, persisted?.secretRef ?? "", {
      workspaceId: "workspace-syncore",
      providerId: "hunter"
    })).toBe("hunter-secret-v2");
    expect(JSON.stringify(state)).not.toContain("hunter-secret-v1");
    expect(JSON.stringify(state)).not.toContain("hunter-secret-v2");
  });

  it("tests enabled provider config in mock mode without network access", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("Network access is forbidden in provider config tests.");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });

    saveProviderConnectionConfig(state, session, {
      providerId: "zerobounce",
      enabled: true,
      secretValue: "zerobounce-secret-9999"
    });
    const result = testProviderConnectionConfig(state, session, "zerobounce");

    expect(result).toMatchObject({
      providerId: "zerobounce",
      status: "Passed",
      message: "Mock connection test passed without network access."
    });
    expect(result.connection.status).toBe("Connected");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fails mock connection testing when an enabled provider has no secret reference", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });

    saveProviderConnectionConfig(state, session, {
      providerId: "hunter",
      enabled: true
    });
    const result = testProviderConnectionConfig(state, session, "hunter");

    expect(result.status).toBe("Failed");
    expect(result.message).toBe("Credential secret reference is missing.");
    expect(result.connection.status).toBe("Needs attention");
    expect(state.providerCredentialAudits[0]).toMatchObject({
      providerId: "hunter",
      action: "Tested"
    });
  });

  it("fails mock connection testing when the encrypted secret record is missing", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });

    saveProviderConnectionConfig(state, session, {
      providerId: "lusha",
      enabled: true,
      secretValue: "lusha-secret-4444"
    });
    state.providerEncryptedSecrets = [];
    const result = testProviderConnectionConfig(state, session, "lusha");

    expect(result.status).toBe("Failed");
    expect(result.message).toBe("Encrypted credential record is missing.");
    expect(result.connection.status).toBe("Needs attention");
  });

  it("disables provider connections and keeps the secret reference server-side only", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });

    saveProviderConnectionConfig(state, session, {
      providerId: "smartlead",
      enabled: true,
      secretValue: "smartlead-secret-2222"
    });
    const disabled = disableProviderConnection(state, session, "smartlead", "Pause outbound sending");

    expect(disabled).toMatchObject({
      providerId: "smartlead",
      enabled: false,
      status: "Disabled",
      hasSecret: true
    });
    expect("secretRef" in disabled).toBe(false);
    expect(state.providerCredentialAudits[0]).toMatchObject({
      providerId: "smartlead",
      action: "Disabled"
    });
  });

  it("requires workspace management permission", () => {
    const state = createSeedState();
    const sdrSession = resolveSession(state, {
      userId: "user-ari",
      workspaceId: "workspace-syncore"
    });

    expect(() =>
      saveProviderConnectionConfig(state, sdrSession, {
        providerId: "apollo",
        enabled: true,
        secretValue: "blocked-secret"
      })
    ).toThrow(/manage_workspace/);
  });

  it("rejects unsupported provider operations", () => {
    const state = createSeedState();
    const session = resolveSession(state, {
      userId: "user-nora",
      workspaceId: "workspace-syncore"
    });

    expect(() =>
      saveProviderConnectionConfig(state, session, {
        providerId: "zerobounce",
        allowedOperations: ["discover_companies" as ProviderCapability]
      })
    ).toThrow(/Unsupported provider operation/);
  });
});
