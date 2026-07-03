import { assertPermission } from "@/lib/phase1/auth";
import { getSession, readState } from "@/lib/phase1/store";

// Authenticated live-state poll for a placed call, consumed by the dialer to
// show initiated -> ringing -> connected -> completed. SDRs may only read their
// own calls; managers/admins may read any call in the workspace.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "send_direct_outreach");

  const call = state.trackedCalls.find(
    (item) => item.id === id && item.workspaceId === session.workspace.id
  );
  if (!call) {
    return new Response("Call not found", { status: 404 });
  }
  if (session.role === "SDR" && call.sdrUserId !== session.user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  return Response.json({
    id: call.id,
    liveState: call.liveState ?? "completed",
    callStatus: call.callStatus,
    disposition: call.disposition,
    durationSeconds: call.durationSeconds,
    hasRecording: Boolean(call.recordingUrl),
    recordingConsent: call.recordingConsent
  });
}
