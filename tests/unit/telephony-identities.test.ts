import { describe, expect, it } from "vitest";
import {
  knownTelephonyIdentityViews,
  resolveUserTelephonyIdentity,
  telephonyIdentityBlockReason
} from "@/lib/phase1/telephony-identities";

function testEnv(values: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values
  };
}

describe("telephony identities", () => {
  it("resolves Sam Carter to a RingCentral number when configured", () => {
    const identity = resolveUserTelephonyIdentity(
      { name: "Sam Carter", email: "sam@syncoretech.com" },
      testEnv({ SYNCORE_RINGCENTRAL_SAM_PHONE_NUMBER: "+13035550142" })
    );

    expect(identity).toEqual({
      displayName: "Sam Carter",
      email: "sam@syncoretech.com",
      provider: "RingCentral",
      phoneNumber: "+13035550142",
      label: "Sam Carter <sam@syncoretech.com> via RingCentral +13035550142"
    });
  });

  it("does not expose a telephony identity until the number is configured", () => {
    expect(resolveUserTelephonyIdentity({ name: "Sam Carter", email: "sam@syncoretech.com" }, testEnv())).toBeUndefined();
    expect(knownTelephonyIdentityViews(testEnv())).toEqual([]);
  });

  it("does not assign Sam's number to another user", () => {
    expect(
      resolveUserTelephonyIdentity(
        { name: "Bobby Jones", email: "bobby@syncoretech.com" },
        testEnv({ SYNCORE_RINGCENTRAL_SAM_PHONE_NUMBER: "+13035550142" })
      )
    ).toBeUndefined();
  });

  it("provides a readable block reason", () => {
    expect(telephonyIdentityBlockReason({ name: "Sam Carter", email: "sam@syncoretech.com" })).toBe(
      "No RingCentral phone number is configured for Sam Carter."
    );
  });
});
