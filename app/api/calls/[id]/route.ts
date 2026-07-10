import { assertPermission } from "@/lib/phase1/auth";
import { getSession, readState } from "@/lib/phase1/store";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { prisma } from "@/lib/prisma";

// Authenticated live-state poll for a placed call, consumed by the dialer to show
// initiated -> ringing -> connected -> completed. SDRs may only read their own
// calls; managers/admins may read any call in the workspace.
//
// The dialer polls this every 2s. Reading the whole ~3MB AppState blob per tick
// meant roughly 90MB of DB egress per fully-polled call — the single largest
// per-interaction egress source. In prod (Prisma driver) we resolve the session via
// the auth fast-path and point-read the one call; the file driver (local/dev) keeps
// the blob path since there is no database.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (resolveStorageDriver() === "prisma") {
    const session = await getSession();
    assertPermission(session, "send_direct_outreach");

    const call = await prisma.trackedCall.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        sdrUserId: true,
        liveState: true,
        callStatus: true,
        disposition: true,
        durationSeconds: true,
        recordingId: true,
        recordingConsent: true
      }
    });

    if (!call || call.workspaceId !== session.workspace.id) {
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
      // The recording pipeline populates recordingId (not recordingUrl); the player
      // and the reconcile worker both key off recordingId.
      hasRecording: Boolean(call.recordingId),
      recordingConsent: call.recordingConsent
    });
  }

  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "send_direct_outreach");

  const call = state.trackedCalls.find((item) => item.id === id && item.workspaceId === session.workspace.id);
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
    hasRecording: Boolean(call.recordingId),
    recordingConsent: call.recordingConsent
  });
}
