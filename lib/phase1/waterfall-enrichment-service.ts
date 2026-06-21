"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/phase1/auth";
import { resolveLiveProviderCredential } from "@/lib/phase1/provider-live-execution";
import { appendAudit, getSession, readState, updateState } from "@/lib/phase1/store";
import { createWaterfallExecutor } from "@/lib/phase1/waterfall-provider-executor";
import { applyWaterfallResults, runWaterfallForLead, type WaterfallContactResult } from "@/lib/phase1/waterfall-runner";
import { buildContactLeadState } from "@/lib/phase1/waterfall-templates";
import { resolveProviderExecutionMode } from "@/lib/providers/live-adapters";
import type { ProviderCredential } from "@/lib/providers/types";

/**
 * Run a template over a set of contacts and persist the results. Three phases
 * bracket the async provider calls so a DB transaction is never held across
 * network I/O (the same out-of-band discipline as M1 live execution):
 *   A. read + authorize + snapshot template/connections/credentials/lead states
 *   B. run the waterfall per contact (async; provider adapters)
 *   C. persist FieldSource + accepted values + cost inside updateState
 */
export async function enrichContactsWithWaterfall(input: { templateId: string; contactIds: string[] }) {
  // Phase A — read + authorize.
  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "manage_waterfalls");
  const workspaceId = session.workspace.id;

  const template = state.waterfallTemplates.find(
    (item) => item.id === input.templateId && item.workspaceId === workspaceId
  );
  if (!template) {
    throw new Error("Waterfall template not found.");
  }

  const connections = state.providerConnections.filter((connection) => connection.workspaceId === workspaceId);
  const credentials: Record<string, ProviderCredential> = {};
  const liveProviderIds = new Set<string>();
  for (const connection of connections) {
    if (!connection.enabled) continue;
    if (resolveProviderExecutionMode(connection.executionMode) !== "live") continue;
    liveProviderIds.add(connection.providerId);
    const credential = resolveLiveProviderCredential(state, connection);
    if (credential.ok) {
      credentials[connection.providerId] = credential.credential;
    }
  }

  const leads = input.contactIds
    .map((id) => state.contacts.find((contact) => contact.id === id && contact.workspaceId === workspaceId))
    .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact))
    .map((contact) => ({ contactId: contact.id, leadState: buildContactLeadState(state, contact) }));

  // Phase B — async run, no state mutation.
  const executor = createWaterfallExecutor({ workspaceId, liveProviderIds, credentials });
  const results: WaterfallContactResult[] = [];
  for (const lead of leads) {
    const result = await runWaterfallForLead({
      template,
      workspaceId,
      targetType: "contact",
      targetId: lead.contactId,
      initialState: lead.leadState,
      connections,
      executor
    });
    results.push({ contactId: lead.contactId, result });
  }

  // Phase C — persist.
  return updateState((freshState, freshSession) => {
    assertPermission(freshSession, "manage_waterfalls");
    const applied = applyWaterfallResults(freshState, freshSession.workspace.id, results);
    appendAudit(freshState, freshSession, {
      objectType: "waterfall_run",
      objectId: input.templateId,
      action: "enrichment_run",
      newValue: { template: template.name, ...applied }
    });
    return applied;
  });
}

export async function runWaterfallEnrichmentAction(formData: FormData) {
  const templateId = typeof formData.get("templateId") === "string" ? String(formData.get("templateId")).trim() : "";
  const contactIds = (typeof formData.get("contactIds") === "string" ? String(formData.get("contactIds")) : "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!templateId || contactIds.length === 0) {
    throw new Error("A template and at least one contact are required.");
  }
  await enrichContactsWithWaterfall({ templateId, contactIds });
  revalidatePath("/waterfalls");
}
