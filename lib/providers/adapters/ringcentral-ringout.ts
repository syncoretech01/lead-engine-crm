import {
  normalizeServerUrl,
  requestRingCentralAccessToken,
  type RingCentralFetch,
  type RingCentralSmsCredential
} from "@/lib/providers/adapters/ringcentral-sms";

// RingOut credential reuses the SMS credential shape (same JWT app auth).
export type RingCentralRingOutCredential = RingCentralSmsCredential;

export type RingCentralRingOutInput = {
  /** The SDR's own RingCentral number (caller id + first leg). */
  fromNumber: string;
  /** The lead's number (second leg). */
  toNumber: string;
  /** Extension to place the RingOut on behalf of; defaults to the auth extension. */
  extensionId?: string;
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
  const extensionPath = input.extensionId ? encodeURIComponent(input.extensionId) : "~";

  const response = await fetchImpl(`${serverUrl}/restapi/v1.0/account/~/extension/${extensionPath}/ring-out`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: { phoneNumber: input.fromNumber },
      to: { phoneNumber: input.toNumber },
      callerId: { phoneNumber: input.fromNumber },
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
