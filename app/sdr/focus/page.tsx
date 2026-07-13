import { readAssignedContactsModel } from "@/lib/phase1/assigned-contacts-read-model";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";
import { FocusWorkspace, type FocusLead } from "@/components/crm/cockpit/focus/focus-workspace";

export const dynamic = "force-dynamic";

export default async function FocusPage({
  searchParams
}: {
  searchParams: Promise<{ lead?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_sdr");

  // SDRs get their own queue; managers/admins get the whole assigned book (the read
  // model scopes by role). Ordering into the queue-weight is done in the client.
  const model = await readAssignedContactsModel(session, workspaceId);
  const rows = model?.rows ?? [];

  const leads: FocusLead[] = rows.map((row) => {
    const dueIso = row.dueAt ?? row.firstTouchDueAt ?? row.followUpDueAt;
    const parsed = dueIso ? Date.parse(dueIso) : Number.NaN;
    return {
      id: row.contactId,
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
      grade: row.grade,
      fitReason: row.notes ?? "",
      companyName: row.companyName,
      companyDomain: row.companyDomain,
      companyIndustry: row.companyIndustry,
      companyLocation: row.companyState,
      lastTouchLabel: lastTouchLabel(row.lastTouchAt, row.touchCount),
      owner: row.ownerName
    };
  });

  return <FocusWorkspace leads={leads} initialLeadId={sp.lead} initialView={sp.view} />;
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
