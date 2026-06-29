import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ringCentralSmsLiveBlockReason,
  sendRingCentralSms,
  type RingCentralFetch
} from "@/lib/providers/adapters/ringcentral-sms";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
  vi.restoreAllMocks();
});

describe("RingCentral SMS adapter", () => {
  it("reports why live SMS cannot run before credentials are complete", () => {
    expect(ringCentralSmsLiveBlockReason(testEnv({ SYNCORE_ENABLE_LIVE_PROVIDERS: "false" }))).toBe(
      "Live providers are disabled."
    );
    expect(ringCentralSmsLiveBlockReason(testEnv({ SYNCORE_ENABLE_LIVE_PROVIDERS: "true" }))).toBe(
      "RingCentral credentials are missing."
    );
    expect(
      ringCentralSmsLiveBlockReason(testEnv({
        SYNCORE_ENABLE_LIVE_PROVIDERS: "true",
        RINGCENTRAL_CLIENT_ID: "client",
        RINGCENTRAL_CLIENT_SECRET: "secret",
        RINGCENTRAL_JWT: "jwt"
      }))
    ).toBeUndefined();
  });

  it("requests a token and sends SMS through injected fetch only", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const fetchImpl: RingCentralFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token" }))
      .mockResolvedValueOnce(jsonResponse({ id: "sms-123" }));

    const result = await sendRingCentralSms(
      {
        fromNumber: "+18167045551",
        toNumber: "+15551234567",
        text: "Hi Sam"
      },
      {
        clientId: "client",
        clientSecret: "secret",
        jwt: "jwt",
        serverUrl: "https://platform.ringcentral.test/"
      },
      "request-1",
      fetchImpl
    );

    expect(result).toMatchObject({
      providerMessageId: "sms-123",
      status: "sent",
      recipient: "+15551234567"
    });
    expect(globalFetch).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const tokenCall = vi.mocked(fetchImpl).mock.calls[0];
    expect(tokenCall[0]).toBe("https://platform.ringcentral.test/restapi/oauth/token");
    expect(tokenCall[1]?.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    });
    expect(String((tokenCall[1]?.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
    expect(String(tokenCall[1]?.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(String(tokenCall[1]?.body)).toContain("assertion=jwt");

    const smsCall = vi.mocked(fetchImpl).mock.calls[1];
    expect(smsCall[0]).toBe("https://platform.ringcentral.test/restapi/v1.0/account/~/extension/~/sms");
    expect(smsCall[1]?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer access-token",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(smsCall[1]?.body))).toEqual({
      from: { phoneNumber: "+18167045551" },
      to: [{ phoneNumber: "+15551234567" }],
      text: "Hi Sam"
    });
  });
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as Response;
}

function testEnv(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}
