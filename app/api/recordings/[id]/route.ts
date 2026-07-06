import { assertPermission, restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { getSession, readState } from "@/lib/phase1/store";
import {
  normalizeServerUrl,
  requestRingCentralAccessToken,
  ringCentralCredentialFromEnv,
  ringCentralSmsLiveBlockReason
} from "@/lib/providers/adapters/ringcentral-sms";

// Streams a call recording for playback. `id` is the TrackedCall id (matches the
// RecordingPlayer's <audio src>). The audio itself is streamed live from
// RingCentral (v1 — no local copy); the reconcile worker has already resolved the
// recordingId onto the call. Consent-gated + workspace-scoped + SDR-owns-or-manager.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "manage_sdr");

  const call = state.trackedCalls.find(
    (item) => item.id === id && item.workspaceId === session.workspace.id
  );
  if (!call) {
    return new Response("Recording not found", { status: 404 });
  }
  if (restrictsToOwnedRecords(session) && call.sdrUserId !== session.user.id) {
    return new Response("Forbidden", { status: 403 });
  }
  if (call.recordingConsent !== "Granted" || !call.recordingId) {
    return new Response("No recording available", { status: 404 });
  }

  const blockReason = ringCentralSmsLiveBlockReason();
  const credential = ringCentralCredentialFromEnv();
  if (blockReason || !credential) {
    return new Response("Recording backend unavailable", { status: 503 });
  }

  const serverUrl = normalizeServerUrl(credential.serverUrl);
  let token: string;
  try {
    token = await requestRingCentralAccessToken(serverUrl, credential, fetch);
  } catch {
    return new Response("Recording auth failed", { status: 502 });
  }

  const rcRes = await fetch(
    `${serverUrl}/restapi/v1.0/account/~/recording/${encodeURIComponent(call.recordingId)}/content`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!rcRes.ok || !rcRes.body) {
    // Most likely RingCentral is still processing the recording; the player retries.
    return new Response("Recording not ready", { status: 502 });
  }

  return new Response(rcRes.body, {
    headers: {
      "Content-Type": rcRes.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "private, max-age=3600"
    }
  });
}
