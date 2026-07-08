"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { enrichContactsWithWaterfall } from "@/lib/phase1/waterfall-enrichment-service";
import { waterfallTemplateWriteTables } from "@/lib/phase1/normalized-write-tables";
import { getWorkspaceSessionContext, updateState } from "@/lib/phase1/store";
import type { WaterfallTemplate } from "@/lib/phase1/types";

const LIVE_TEMPLATE_ID_SUFFIX = "live-email";
const MAX_COST_PER_LEAD_CENTS = 25;

// A waterfall tuned to the four adapters that actually exist as live providers:
// find missing emails via Apollo -> Hunter, then verify via MillionVerifier ->
// Hunter. (The built-in default templates reference zerobounce/lusha/twilio,
// which have no live adapter and would silently no-op.)
function buildLiveEmailTemplate(workspaceId: string, now: string): WaterfallTemplate {
  const id = `wf-${workspaceId}-${LIVE_TEMPLATE_ID_SUFFIX}`;
  return {
    id,
    workspaceId,
    name: "Live email — find + verify",
    campaignType: "reenrichment",
    status: "Active",
    isDefault: false,
    outreachChannel: "email",
    requiredFields: ["email:validated"],
    maxCostPerLeadCents: MAX_COST_PER_LEAD_CENTS,
    steps: [
      {
        id: `${id}-find`,
        order: 1,
        stage: "find_email",
        capability: "find_email",
        providerIds: ["apollo", "hunter"],
        runIf: { field: "email", op: "isMissing" }
      },
      {
        id: `${id}-verify`,
        order: 2,
        stage: "verify_email",
        capability: "verify_email",
        providerIds: ["millionverifier", "hunter"],
        qualityGate: { acceptStatus: ["valid", "catch_all"], allowCatchAll: true },
        stopIf: { field: "email.validationStatus", op: "in", value: ["valid"] }
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Run REAL email find + verify (Apollo/Hunter/MillionVerifier) over the
 * workspace's contacts via the waterfall engine. Only makes network calls for
 * providers configured Enabled + Live with a stored key; otherwise it's a no-op.
 * `limit` (e.g. "5") runs a small test batch; "all"/empty runs every contact.
 */
export async function runLiveContactEnrichmentAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const { workspaceId } = await getWorkspaceSessionContext("manage_waterfalls");
    const limitRaw = String(formData.get("limit") ?? "").trim().toLowerCase();
    const limit = limitRaw && limitRaw !== "all" ? Math.max(1, Math.trunc(Number(limitRaw) || 0)) : undefined;

    // Ensure the tuned template exists (scoped, fast write).
    const templateId = `wf-${workspaceId}-${LIVE_TEMPLATE_ID_SUFFIX}`;
    await updateState((state) => {
      if (state.waterfallTemplates.some((t) => t.id === templateId && t.workspaceId === workspaceId)) {
        return;
      }
      state.waterfallTemplates.push(buildLiveEmailTemplate(workspaceId, new Date().toISOString()));
    }, { normalizedTables: waterfallTemplateWriteTables });

    // Target contacts — ids only, straight from Prisma (no full-state read).
    const { prisma } = await import("@/lib/prisma");
    const contacts = await prisma.contact.findMany({
      where: { workspaceId },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
      ...(limit ? { take: limit } : {})
    });
    const contactIds = contacts.map((c) => c.id);
    if (contactIds.length === 0) {
      return { ok: false, error: "No contacts to enrich yet." };
    }

    const summary = await enrichContactsWithWaterfall({ templateId, contactIds });
    revalidatePath("/enrichment");
    revalidatePath("/crm/contacts");

    const usd = (summary.costCents / 100).toFixed(2);
    return {
      ok: true,
      message: `Processed ${summary.contactsProcessed} contact${summary.contactsProcessed === 1 ? "" : "s"} · ${summary.fieldsWritten} field${summary.fieldsWritten === 1 ? "" : "s"} written · $${usd} spent`
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: error instanceof Error ? error.message : "Live enrichment run failed." };
  }
}
