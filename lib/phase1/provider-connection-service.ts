"use server";

import { assertPermission } from "@/lib/phase1/auth";
import { providerConnectionWriteTables } from "@/lib/phase1/normalized-write-tables";
import {
  disableProviderConnection,
  providerConnectionViewsForWorkspace,
  saveProviderConnectionConfig,
  setProviderExecutionMode,
  testProviderConnectionConfig,
  type ProviderConnectionSafeView,
  type ProviderConnectionTestResult,
  type SaveProviderConnectionInput
} from "@/lib/phase1/provider-connections";
import { getSession, readState, updateState } from "@/lib/phase1/store";
import type { ProviderExecutionMode, ProviderId } from "@/lib/providers/types";

export async function listProviderConnectionViews(): Promise<ProviderConnectionSafeView[]> {
  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "manage_workspace");
  return providerConnectionViewsForWorkspace(state, session.workspace.id);
}

export async function saveProviderConnection(input: SaveProviderConnectionInput): Promise<ProviderConnectionSafeView> {
  return updateState(
    (state, session) => saveProviderConnectionConfig(state, session, input),
    { normalizedTables: providerConnectionWriteTables }
  );
}

export async function testProviderConnection(providerId: ProviderId): Promise<ProviderConnectionTestResult> {
  return updateState(
    (state, session) => testProviderConnectionConfig(state, session, providerId),
    { normalizedTables: providerConnectionWriteTables }
  );
}

export async function setProviderConnectionExecutionMode(
  providerId: ProviderId,
  executionMode: ProviderExecutionMode
): Promise<ProviderConnectionSafeView> {
  return updateState(
    (state, session) => setProviderExecutionMode(state, session, providerId, executionMode),
    { normalizedTables: providerConnectionWriteTables }
  );
}

export async function disableProviderConnectionForWorkspace(
  providerId: ProviderId,
  reason?: string
): Promise<ProviderConnectionSafeView> {
  return updateState(
    (state, session) => disableProviderConnection(state, session, providerId, reason),
    { normalizedTables: providerConnectionWriteTables }
  );
}
