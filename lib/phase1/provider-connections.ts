import { randomUUID } from "node:crypto";
import { assertPermission } from "@/lib/phase1/auth";
import { providerSecretHealth, storeEncryptedProviderSecret } from "@/lib/phase1/provider-secret-vault";
import type { AppState, ProviderConnection, ProviderCredentialAudit, Session } from "@/lib/phase1/types";
import { providerConfig, providerRegistry } from "@/lib/providers/registry";
import type { ProviderCapability, ProviderId } from "@/lib/providers/types";

type DefaultProviderConnectionOptions = {
  workspaceId: string;
  now: string;
  actorUserId?: string;
};

export type ProviderConnectionSafeView = Omit<ProviderConnection, "secretRef"> & {
  hasSecret: boolean;
};

export type SaveProviderConnectionInput = {
  providerId: ProviderId;
  enabled?: boolean;
  credentialLabel?: string;
  secretValue?: string;
  scopes?: string[];
  allowedOperations?: ProviderCapability[];
  rateLimitPerMinute?: number;
  dailyBudgetCents?: number;
  waterfallOrder?: number;
};

export type ProviderConnectionTestResult = {
  providerId: ProviderId;
  status: ProviderConnection["lastTestStatus"];
  checkedAt: string;
  checkedById: string;
  message: string;
  connection: ProviderConnectionSafeView;
};

export function createDefaultProviderConnections({
  workspaceId,
  now,
  actorUserId
}: DefaultProviderConnectionOptions): ProviderConnection[] {
  return providerRegistry.map((provider, index) => ({
    id: providerConnectionId(workspaceId, provider.id),
    workspaceId,
    providerId: provider.id,
    displayName: provider.name,
    status: "Not configured",
    enabled: false,
    executionMode: provider.executionMode,
    categories: [...provider.categories],
    capabilities: [...provider.capabilities],
    scopes: [],
    allowedOperations: [...provider.capabilities],
    secretStorage: "Not configured",
    secretVersion: 0,
    waterfallOrder: index + 1,
    lastTestStatus: "Not tested",
    createdById: actorUserId,
    updatedById: actorUserId,
    createdAt: now,
    updatedAt: now
  }));
}

export function providerConnectionViewsForWorkspace(state: AppState, workspaceId: string): ProviderConnectionSafeView[] {
  return state.providerConnections
    .filter((connection) => connection.workspaceId === workspaceId)
    .sort((a, b) => a.waterfallOrder - b.waterfallOrder || a.displayName.localeCompare(b.displayName))
    .map(safeProviderConnectionView);
}

export function saveProviderConnectionConfig(
  state: AppState,
  session: Session,
  input: SaveProviderConnectionInput
): ProviderConnectionSafeView {
  assertPermission(session, "manage_workspace");
  const provider = providerConfig(input.providerId);
  const now = new Date().toISOString();
  const existing = ensureProviderConnection(state, session.workspace.id, input.providerId, now, session.user.id);
  const nextSecretVersion = input.secretValue ? existing.secretVersion + 1 : existing.secretVersion;
  const secretChanged = nextSecretVersion !== existing.secretVersion;
  const enabled = input.enabled ?? existing.enabled;
  const allowedOperations = input.allowedOperations
    ? validateAllowedOperations(input.allowedOperations, provider.capabilities)
    : existing.allowedOperations;
  const scopes = input.scopes ? cleanStringList(input.scopes) : existing.scopes;
  const credentialLabel = normalizedOptionalString(input.credentialLabel) ?? existing.credentialLabel;
  const hasSecretAfterSave = secretChanged || Boolean(existing.secretRef);

  existing.displayName = provider.name;
  existing.enabled = enabled;
  existing.executionMode = provider.executionMode;
  existing.categories = [...provider.categories];
  existing.capabilities = [...provider.capabilities];
  existing.scopes = scopes;
  existing.allowedOperations = allowedOperations;
  existing.credentialLabel = credentialLabel;
  existing.rateLimitPerMinute = optionalPositiveInt(input.rateLimitPerMinute, existing.rateLimitPerMinute);
  existing.dailyBudgetCents = optionalPositiveInt(input.dailyBudgetCents, existing.dailyBudgetCents);
  existing.waterfallOrder = optionalPositiveInt(input.waterfallOrder, existing.waterfallOrder) ?? existing.waterfallOrder;
  existing.updatedById = session.user.id;
  existing.updatedAt = now;

  if (secretChanged && input.secretValue) {
    const encryptedSecret = storeEncryptedProviderSecret(state, {
      workspaceId: session.workspace.id,
      providerConnectionId: existing.id,
      providerId: input.providerId,
      secretVersion: nextSecretVersion,
      secretValue: input.secretValue,
      actorUserId: session.user.id,
      createdAt: now
    });
    existing.secretRef = encryptedSecret.secretRef;
    existing.secretStorage = "Encrypted database";
    existing.secretVersion = nextSecretVersion;
    existing.maskedSecretSuffix = maskedSecretSuffix(input.secretValue);
  }

  existing.status = providerStatusFor({ enabled, hasSecret: hasSecretAfterSave });

  const action: ProviderCredentialAudit["action"] = secretChanged
    ? existing.secretVersion === 1
      ? "Created"
      : "Secret rotated"
    : "Updated";
  appendProviderCredentialAudit(state, {
    workspaceId: session.workspace.id,
    providerConnectionId: existing.id,
    providerId: existing.providerId,
    actorUserId: session.user.id,
    action,
    secretVersion: existing.secretVersion,
    createdAt: now,
    redactedMetadata: {
      enabled,
      status: existing.status,
      credentialLabel,
      maskedSecretSuffix: existing.maskedSecretSuffix,
      scopes,
      allowedOperations,
      rateLimitPerMinute: existing.rateLimitPerMinute,
      dailyBudgetCents: existing.dailyBudgetCents,
      waterfallOrder: existing.waterfallOrder
    }
  });

  return safeProviderConnectionView(existing);
}

export function testProviderConnectionConfig(
  state: AppState,
  session: Session,
  providerId: ProviderId
): ProviderConnectionTestResult {
  assertPermission(session, "manage_workspace");
  const now = new Date().toISOString();
  const connection = ensureProviderConnection(state, session.workspace.id, providerId, now, session.user.id);
  let status: ProviderConnection["lastTestStatus"] = "Skipped";
  let message = "Provider is disabled.";

  if (connection.enabled) {
    const invalidOperations = connection.allowedOperations.filter(
      (operation) => !connection.capabilities.includes(operation)
    );
    if (invalidOperations.length) {
      status = "Failed";
      message = `Unsupported operations: ${invalidOperations.join(", ")}`;
    } else {
      const secretHealth = providerSecretHealth(state, connection);
      if (!secretHealth.ok) {
        status = "Failed";
        message = secretHealth.reason;
      } else {
        status = "Passed";
        message = "Mock connection test passed without network access.";
      }
    }
  }

  connection.lastTestStatus = status;
  connection.lastTestedAt = now;
  connection.lastTestedById = session.user.id;
  connection.lastTestError = status === "Failed" ? message : undefined;
  connection.status = status === "Passed" ? "Connected" : status === "Failed" ? "Needs attention" : connection.status;
  connection.updatedById = session.user.id;
  connection.updatedAt = now;

  appendProviderCredentialAudit(state, {
    workspaceId: session.workspace.id,
    providerConnectionId: connection.id,
    providerId: connection.providerId,
    actorUserId: session.user.id,
    action: "Tested",
    secretVersion: connection.secretVersion,
    createdAt: now,
    redactedMetadata: {
      status,
      message,
      enabled: connection.enabled,
      hasSecret: Boolean(connection.secretRef)
    }
  });

  return {
    providerId,
    status,
    checkedAt: now,
    checkedById: session.user.id,
    message,
    connection: safeProviderConnectionView(connection)
  };
}

export function disableProviderConnection(
  state: AppState,
  session: Session,
  providerId: ProviderId,
  reason = "Disabled by workspace admin"
): ProviderConnectionSafeView {
  assertPermission(session, "manage_workspace");
  const now = new Date().toISOString();
  const connection = ensureProviderConnection(state, session.workspace.id, providerId, now, session.user.id);

  connection.enabled = false;
  connection.status = "Disabled";
  connection.updatedById = session.user.id;
  connection.updatedAt = now;

  appendProviderCredentialAudit(state, {
    workspaceId: session.workspace.id,
    providerConnectionId: connection.id,
    providerId,
    actorUserId: session.user.id,
    action: "Disabled",
    secretVersion: connection.secretVersion,
    createdAt: now,
    redactedMetadata: {
      reason,
      enabled: false,
      status: connection.status
    }
  });

  return safeProviderConnectionView(connection);
}

export function createProviderCredentialAudit(input: {
  workspaceId: string;
  providerConnectionId: string;
  providerId: ProviderCredentialAudit["providerId"];
  action: ProviderCredentialAudit["action"];
  secretVersion?: number;
  actorUserId?: string;
  redactedMetadata?: ProviderCredentialAudit["redactedMetadata"];
  createdAt: string;
}): ProviderCredentialAudit {
  return {
    id: `provider-credential-audit-${randomUUID()}`,
    workspaceId: input.workspaceId,
    providerConnectionId: input.providerConnectionId,
    providerId: input.providerId,
    actorUserId: input.actorUserId,
    action: input.action,
    secretVersion: input.secretVersion ?? 0,
    redactedMetadata: input.redactedMetadata ?? {},
    createdAt: input.createdAt
  };
}

export function providerConnectionId(workspaceId: string, providerId: string) {
  return `provider-connection-${workspaceId}-${providerId}`;
}

function ensureProviderConnection(
  state: AppState,
  workspaceId: string,
  providerId: ProviderId,
  now: string,
  actorUserId?: string
) {
  const existing = state.providerConnections.find(
    (connection) => connection.workspaceId === workspaceId && connection.providerId === providerId
  );
  if (existing) return existing;

  const provider = providerConfig(providerId);
  const connection: ProviderConnection = {
    id: providerConnectionId(workspaceId, provider.id),
    workspaceId,
    providerId: provider.id,
    displayName: provider.name,
    status: "Not configured",
    enabled: false,
    executionMode: provider.executionMode,
    categories: [...provider.categories],
    capabilities: [...provider.capabilities],
    scopes: [],
    allowedOperations: [...provider.capabilities],
    secretStorage: "Not configured",
    secretVersion: 0,
    waterfallOrder: state.providerConnections.filter((item) => item.workspaceId === workspaceId).length + 1,
    lastTestStatus: "Not tested",
    createdById: actorUserId,
    updatedById: actorUserId,
    createdAt: now,
    updatedAt: now
  };
  state.providerConnections.push(connection);
  return connection;
}

function appendProviderCredentialAudit(
  state: AppState,
  input: Parameters<typeof createProviderCredentialAudit>[0]
) {
  state.providerCredentialAudits.unshift(createProviderCredentialAudit(input));
}

function safeProviderConnectionView(connection: ProviderConnection): ProviderConnectionSafeView {
  const { secretRef: _secretRef, ...safeConnection } = connection;
  return {
    ...safeConnection,
    hasSecret: Boolean(connection.secretRef)
  };
}

function validateAllowedOperations(
  requested: ProviderCapability[],
  supported: ProviderCapability[]
): ProviderCapability[] {
  const clean = Array.from(new Set(requested));
  const unsupported = clean.filter((operation) => !supported.includes(operation));
  if (unsupported.length) {
    throw new Error(`Unsupported provider operation(s): ${unsupported.join(", ")}.`);
  }
  return clean;
}

function cleanStringList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizedOptionalString(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function optionalPositiveInt(value: number | undefined, fallback: number | undefined) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Provider numeric settings must be positive numbers.");
  }
  return Math.round(value);
}

function maskedSecretSuffix(secretValue: string) {
  const trimmed = secretValue.trim();
  return trimmed ? trimmed.slice(-4).padStart(Math.min(4, trimmed.length), "*") : undefined;
}

function providerStatusFor(input: { enabled: boolean; hasSecret: boolean }): ProviderConnection["status"] {
  if (!input.enabled && input.hasSecret) return "Disabled";
  if (!input.enabled) return "Not configured";
  return input.hasSecret ? "Connected" : "Needs attention";
}
