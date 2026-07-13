import { readAssignedContactsModel } from "@/lib/phase1/assigned-contacts-read-model";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";
import { MyContactsView, type CockpitMyContactRow } from "@/components/crm/cockpit/my-contacts-view";

export const dynamic = "force-dynamic";

export default async function MyContactsPage({
  searchParams
}: {
  searchParams: Promise<{ sdr?: string }>;
}) {
  const sp = await searchParams;
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_sdr");
  const isSdr = session.role === "SDR";
  // SDRs are locked to their own book; managers/admins see the whole assigned book
  // (or one SDR via ?sdr=). The read model now fetches the full book, so no SDR's
  // older assignments are hidden below the old take:500 cap ("Sam's leads" bug).
  const sdrFilter = isSdr ? undefined : sp.sdr || undefined;

  const model = await readAssignedContactsModel(session, workspaceId, { sdrId: sdrFilter });
  const rows = model?.rows ?? [];

  const tableRows: CockpitMyContactRow[] = rows.map((row) => ({
    contactId: row.contactId,
    contactName: row.contactName,
    title: row.title,
    companyName: row.companyName,
    companyDomain: row.companyDomain,
    priority: row.priority,
    status: row.status,
    slaStatus: row.slaStatus,
    lastTouchLabel: lastTouchLabel(row.lastTouchAt, row.touchCount),
    phone: row.phone,
    hasPhone: Boolean(row.phone && row.phone.trim()),
    replied: row.status === "Replied"
  }));

  return (
    <div className="cockpit min-h-full px-6 py-6 md:px-8">
      <MyContactsView
        title={isSdr ? "My Contacts" : "Assigned Contacts"}
        subline={`${tableRows.length} assigned contact${tableRows.length === 1 ? "" : "s"} · newest assignment first`}
        rows={tableRows}
      />
    </div>
  );
}

// Precomputed server-side (Date.now here is fine — never reaches the client table).
function lastTouchLabel(lastTouchAt: string | undefined, touchCount: number): string {
  if (!lastTouchAt) {
    return touchCount > 0 ? `${touchCount} touch${touchCount === 1 ? "" : "es"}` : "No touches yet";
  }
  return `${relativeSince(lastTouchAt)}${touchCount > 0 ? ` · ${touchCount}` : ""}`;
}

function relativeSince(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs)) return "—";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
