import { readAssignedContactsModel } from "@/lib/phase1/assigned-contacts-read-model";
import { parseBrokerNotes } from "@/lib/phase1/broker-notes";
import { isUtcToday } from "@/lib/phase1/date-utils";
import { readFocusContext } from "@/lib/phase1/focus-context-read-model";
import { readFocusTimelines } from "@/lib/phase1/focus-timeline-read-model";
import { readKeyAccountFields } from "@/lib/phase1/key-account-fields-read-model";
import { localTimeForState } from "@/lib/phase1/us-timezones";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";
import { resolveUserTelephonyIdentity, telephonyIdentityBlockReason } from "@/lib/phase1/telephony-identities";
import { FocusWorkspace, type FocusLead } from "@/components/crm/cockpit/focus/focus-workspace";

export const dynamic = "force-dynamic";

export default async function FocusPage({
  searchParams
}: {
  searchParams: Promise<{ lead?: string; view?: string; start?: string }>;
}) {
  const sp = await searchParams;
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_sdr");

  // SDRs get their own queue; managers/admins get the whole assigned book (the read
  // model scopes by role). Ordering into the queue-weight is done in the client.
  const model = await readAssignedContactsModel(session, workspaceId, { callPlan: true });
  const rows = model?.rows ?? [];

  // Recent activity + open opportunity/work per contact for the dossier.
  const contactIds = rows.map((row) => row.contactId);
  const companyIds = rows.map((row) => row.companyId);
  const [timelines, context, keyFields] = await Promise.all([
    readFocusTimelines(workspaceId, contactIds),
    readFocusContext(workspaceId, contactIds),
    readKeyAccountFields(workspaceId, companyIds)
  ]);

  // The SDR's own RingCentral line (mirrors the contact-record Call button): the
  // caller label to show, or the reason their line can't place calls.
  const identity = resolveUserTelephonyIdentity(session.user);
  const callerLabel = identity ? `${identity.displayName} · ${identity.phoneNumber}` : null;
  const lineBlockReason = identity ? null : telephonyIdentityBlockReason(session.user);

  const leads: FocusLead[] = rows.map((row) => {
    const dueIso = row.dueAt ?? row.firstTouchDueAt ?? row.followUpDueAt;
    const parsed = dueIso ? Date.parse(dueIso) : Number.NaN;
    // Some workspaces store account attributes as a raw notes blob; parse it into
    // structured Key Account Fields + a clean fit reason + the state for local time
    // (fixes the raw-dump fit reason + empty KAF + "Unknown" local time).
    const broker = parseBrokerNotes(row.notes ?? "");
    const local = localTimeForState(broker?.state || row.companyState);
    const customFields = keyFields.get(row.companyId) ?? [];
    const context_ = context.get(row.contactId);
    return {
      id: row.contactId,
      assignmentId: row.id,
      name: row.contactName,
      title: row.title,
      email: row.email,
      phone: row.phone,
      hasPhone: Boolean(row.phone && row.phone.trim()),
      priority: row.priority,
      status: row.status,
      slaStatus: row.slaStatus,
      dueLabel: row.dueLabel,
      dueAtMs: Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER,
      overdue: row.slaStatus === "Overdue",
      dueToday: Boolean(dueIso && isUtcToday(dueIso)),
      grade: row.grade,
      fitReason: broker?.fitReason || (row.notes ?? ""),
      companyId: row.companyId,
      companyName: row.companyName,
      companyDomain: row.companyDomain,
      companyIndustry: row.companyIndustry,
      companyLocation: broker?.location || row.companyState,
      lastTouchLabel: lastTouchLabel(row.lastTouchAt, row.touchCount),
      owner: row.ownerName,
      emailEligible: row.emailEligible,
      localTimeLabel: local?.label ?? "",
      outsideWindow: local?.outsideWindow ?? false,
      openOpportunity: context_?.openOpportunity ?? "",
      openWork: context_?.openWork ?? "",
      // Prefer real custom fields; fall back to the parsed broker blob so the card
      // is populated for the broker-import workspace.
      keyAccountFields: customFields.length ? customFields : broker?.fields ?? [],
      timeline: timelines.get(row.contactId) ?? [],
      tasks: context_?.tasks ?? [],
      opportunities: context_?.opportunities ?? []
    };
  });

  return (
    <FocusWorkspace
      leads={leads}
      initialLeadId={sp.lead}
      initialView={sp.view}
      callerLabel={callerLabel}
      lineBlockReason={lineBlockReason}
      autoStart={sp.start === "1"}
      dailyCallPlan={model?.dailyCallPlan}
    />
  );
}

// Precomputed server-side (Date.now here never reaches the client).
function lastTouchLabel(lastTouchAt: string | undefined, touchCount: number): string {
  if (!lastTouchAt) {
    return touchCount > 0 ? `${touchCount} touch${touchCount === 1 ? "" : "es"}` : "No touches yet";
  }
  const diffMs = Date.now() - Date.parse(lastTouchAt);
  if (!Number.isFinite(diffMs)) return "—";
  const minutes = Math.round(diffMs / 60000);
  let base: string;
  if (minutes < 1) base = "just now";
  else if (minutes < 60) base = `${minutes}m ago`;
  else if (minutes < 1440) base = `${Math.round(minutes / 60)}h ago`;
  else if (minutes < 43200) base = `${Math.round(minutes / 1440)}d ago`;
  else base = `${Math.round(minutes / 43200)}mo ago`;
  return `${base}${touchCount > 0 ? ` · ${touchCount}` : ""}`;
}
