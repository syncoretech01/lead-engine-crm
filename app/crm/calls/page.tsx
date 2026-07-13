import { readFastCallsModel } from "@/lib/phase1/calls-read-model";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";
import { CallsView, type CockpitCallRow } from "@/components/crm/cockpit/calls-view";

export const dynamic = "force-dynamic";

export default async function CallsPage({
  searchParams
}: {
  searchParams: Promise<{ sdr?: string }>;
}) {
  const sp = await searchParams;
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_sdr");
  const isSdr = session.role === "SDR";
  const timeZone = session.user.timezone || undefined;

  const model = await readFastCallsModel(session, workspaceId, { sdrId: sp.sdr || undefined });
  const calls = model?.calls ?? [];

  // Precompute all display strings + the recording state server-side so the client
  // table never touches Date.now() (no hydration drift).
  const rows: CockpitCallRow[] = calls.map((call) => {
    const recording = recordingState(call.recordingId, call.recordingConsent, call.createdAt);
    return {
      id: call.id,
      contactId: call.contactId,
      contactName: call.contactName,
      companyName: call.companyName ?? "",
      durationLabel: formatDuration(call.durationSeconds),
      outcomeLabel: dispositionLabel(call.callStatus, call.disposition),
      outcomeTone: outcomeTone(call.callStatus),
      whenLabel: formatWhen(call.createdAt, timeZone),
      recordingLabel: recordingLabel(recording),
      recorded: recording === "ready",
      connected: call.callStatus === "Connected",
      note: call.note ?? ""
    };
  });

  return (
    <div className="cockpit min-h-full px-6 py-6 md:px-8">
      <CallsView
        title={isSdr ? "Calls" : "Call log"}
        subline={`${rows.length} logged call${rows.length === 1 ? "" : "s"} · auto-logged from the softphone`}
        rows={rows}
      />
    </div>
  );
}

type RecordingState = "ready" | "processing" | "unavailable" | "none";

function recordingState(recordingId: string | undefined, consent: string, createdAt: string): RecordingState {
  if (recordingId) return "ready";
  if (consent === "Granted") {
    // Recorded on-demand; the reconcile worker pulls the recording once RingCentral
    // finishes processing. After ~30 min with nothing, give up.
    const ageMs = Date.now() - Date.parse(createdAt);
    return Number.isFinite(ageMs) && ageMs < 30 * 60 * 1000 ? "processing" : "unavailable";
  }
  return "none";
}

function recordingLabel(state: RecordingState): string {
  if (state === "ready") return "Recorded";
  if (state === "processing") return "Processing…";
  if (state === "unavailable") return "Unavailable";
  return "—";
}

function dispositionLabel(callStatus: string, disposition: string): string {
  if (callStatus === "Dialed") return "Placed";
  if (callStatus === "Connected") return disposition && disposition !== "No answer" ? disposition : "Connected";
  return callStatus;
}

function outcomeTone(callStatus: string): CockpitCallRow["outcomeTone"] {
  if (callStatus === "Connected") return "teal";
  if (callStatus === "Failed" || callStatus === "Busy") return "red";
  if (callStatus === "No answer" || callStatus === "Voicemail") return "amber";
  return "info";
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatWhen(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {})
  });
}
