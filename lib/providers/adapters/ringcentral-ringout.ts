import {
  normalizeServerUrl,
  requestRingCentralAccessToken,
  type RingCentralFetch,
  type RingCentralSmsCredential
} from "@/lib/providers/adapters/ringcentral-sms";

// RingOut credential reuses the SMS credential shape (same JWT app auth).
export type RingCentralRingOutCredential = RingCentralSmsCredential;

export type RingCentralRingOutInput = {
  /** The SDR's real phone (cell/desk) RingCentral rings first — must be reachable. */
  fromNumber: string;
  /** The lead's number (second leg). */
  toNumber: string;
  /** Extension to place the RingOut on behalf of; defaults to the auth extension. */
  extensionId?: string;
  /** Caller ID shown to the lead. Only valid when the call is placed as an identity
   *  that owns this number (i.e. the SDR's own JWT); otherwise RingCentral rejects
   *  it (TEL-107) and we omit it so the account default (company number) is used. */
  callerId?: string;
};

export type RingCentralRingOutResult = {
  ringOutId: string;
  status: string;
};

// Places a 2-legged RingOut: RingCentral rings `fromNumber` (the SDR's phone)
// first, then bridges to `toNumber` (the lead). Uses the existing JWT app auth,
// optionally on behalf of a specific extension. No browser audio is involved.
export async function ringCentralRingOut(
  input: RingCentralRingOutInput,
  credential: RingCentralRingOutCredential,
  fetchImpl: RingCentralFetch = fetch
): Promise<RingCentralRingOutResult> {
  if (!input.fromNumber || !input.toNumber) {
    throw new Error("RingOut requires both `fromNumber` and `toNumber`.");
  }

  const serverUrl = normalizeServerUrl(credential.serverUrl);
  const accessToken = await requestRingCentralAccessToken(serverUrl, credential, fetchImpl);

  // Place the RingOut on the app JWT's OWN extension (~) and ring the SDR's number
  // as the first leg. Placing it on the SDR's *own* extension (on-behalf-of) needs
  // the JWT user to be granted the DomesticCalls "extended scope" delegated-calling
  // permission, which RingCentral gates; this callback model is a normal RingOut
  // that needs no extra permission. The lead still sees the SDR's number (callerId).
  const response = await fetchImpl(`${serverUrl}/restapi/v1.0/account/~/extension/~/ring-out`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    // `from` is the SDR's real phone (cell/desk) that RingCentral rings first — it
    // must be a reachable phone, NOT a RingCentral internal DID (GenericError).
    // `callerId` (the SDR's own DID) is only included when the call is placed as
    // that SDR (their own JWT); without it, RingCentral uses the account default
    // (company number) toward the lead.
    body: JSON.stringify({
      from: { phoneNumber: input.fromNumber },
      to: { phoneNumber: input.toNumber },
      ...(input.callerId ? { callerId: { phoneNumber: input.callerId } } : {}),
      playPrompt: false
    })
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      stringValue(json.message) ||
      stringValue(json.error_description) ||
      stringValue(json.error) ||
      `RingCentral RingOut failed. HTTP ${response.status}.`;
    throw new Error(message);
  }

  const statusBlock = (json.status ?? {}) as Record<string, unknown>;
  return {
    ringOutId: stringValue(json.id) || stringValue(json.uri),
    status: stringValue(statusBlock.callStatus) || stringValue(json.callStatus) || "InProgress"
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
