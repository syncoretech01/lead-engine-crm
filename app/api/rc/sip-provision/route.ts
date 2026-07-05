import { assertPermission } from "@/lib/phase1/auth";
import { decryptSecretString } from "@/lib/phase1/secret-box";
import { getSession, readState } from "@/lib/phase1/store";
import {
  normalizeServerUrl,
  requestRingCentralAccessToken,
  ringCentralCredentialFromEnv,
  ringCentralSmsLiveBlockReason
} from "@/lib/providers/adapters/ringcentral-sms";

// Provisions a browser WebRTC softphone for the current SDR. Authenticates with
// the SDR's OWN RingCentral JWT (so the softphone registers AS them — their number
// shows to the lead), falling back to the shared admin JWT. Returns the `sipInfo`
// the RingCentral Web Phone SDK needs, plus the caller ID to present.
//
// Requires the RingCentral app to have the **VoipCalling** scope, else RingCentral
// returns 403 (surfaced here as 502 with the message).
export async function GET() {
  const state = await readState();
  const session = await getSession(state);
  assertPermission(session, "send_direct_outreach");

  const liveBlocked = ringCentralSmsLiveBlockReason();
  const envCredential = ringCentralCredentialFromEnv();
  if (liveBlocked || !envCredential) {
    return Response.json({ error: liveBlocked ?? "RingCentral is not configured." }, { status: 503 });
  }

  const sdrUser = state.users.find((user) => user.id === session.user.id) ?? session.user;
  let sdrJwt: string | undefined;
  if (sdrUser.ringCentralJwt) {
    try {
      sdrJwt = decryptSecretString(sdrUser.ringCentralJwt);
    } catch {
      sdrJwt = undefined;
    }
  }
  const credential = sdrJwt ? { ...envCredential, jwt: sdrJwt } : envCredential;
  const callerId = sdrJwt ? sdrUser.ringCentralCallerId : undefined;

  const serverUrl = normalizeServerUrl(credential.serverUrl);
  let accessToken: string;
  try {
    accessToken = await requestRingCentralAccessToken(serverUrl, credential, fetch);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "RingCentral auth failed." },
      { status: 502 }
    );
  }

  const res = await fetch(`${serverUrl}/restapi/v1.0/client-info/sip-provision`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ sipInfo: [{ transport: "WSS" }] })
  });
  const json = (await res.json().catch(() => ({}))) as {
    sipInfo?: unknown[];
    message?: string;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || !json.sipInfo?.[0]) {
    const message = json.message || json.errors?.[0]?.message || `SIP provisioning failed (HTTP ${res.status}).`;
    return Response.json({ error: message }, { status: 502 });
  }

  // sipInfo carries short-lived SIP credentials scoped to this SDR's own extension —
  // returned only to the authenticated SDR's browser for their softphone to register.
  return Response.json({ sipInfo: json.sipInfo[0], callerId: callerId ?? null });
}
