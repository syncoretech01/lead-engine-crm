import { afterEach, describe, expect, it, vi } from "vitest";
import { millionVerifierVerifyEmail } from "@/lib/providers/adapters/millionverifier";
import { hunterFindEmail, hunterVerifyEmail } from "@/lib/providers/adapters/hunter";
import { apolloFindEmail } from "@/lib/providers/adapters/apollo";
import { apifyHarvestDiscoverContacts, apifyMapsDiscoverCompanies } from "@/lib/providers/adapters/apify";
import { getLiveProviderOperation, resetLiveProviderAdapters } from "@/lib/providers/live-adapters";
import {
  ensureLiveProviderAdaptersRegistered,
  resetLiveProviderAdapterRegistration
} from "@/lib/providers/register-live-adapters";
import type { ProviderRequestContext } from "@/lib/providers/types";

function stubFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({ ok, status, json: async () => body }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function ctx(secret?: string): ProviderRequestContext {
  return {
    workspaceId: "ws",
    providerId: "millionverifier",
    executionMode: "live",
    requestId: "t",
    credential: secret ? { source: "vault", secret } : undefined
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetLiveProviderAdapters();
  resetLiveProviderAdapterRegistration();
});

describe("MillionVerifier adapter", () => {
  it("maps result codes to validation status + grade", async () => {
    stubFetch({ result: "ok" });
    const ok = await millionVerifierVerifyEmail({ email: "a@b.com" }, ctx("key"));
    expect(ok).toMatchObject({ status: "ok" });
    expect(ok.data[0]).toMatchObject({ status: "valid", grade: "A", catchAll: false });

    stubFetch({ result: "catch_all" });
    const catchAll = await millionVerifierVerifyEmail({ email: "a@b.com" }, ctx("key"));
    expect(catchAll.data[0]).toMatchObject({ status: "risky", catchAll: true, grade: "C" });

    stubFetch({ result: "invalid" });
    const invalid = await millionVerifierVerifyEmail({ email: "a@b.com" }, ctx("key"));
    expect(invalid.data[0]).toMatchObject({ status: "invalid", grade: "D" });
  });

  it("errors (and makes no call) without a credential or email", async () => {
    const fetchSpy = stubFetch({ result: "ok" });
    expect((await millionVerifierVerifyEmail({ email: "a@b.com" }, ctx(undefined))).status).toBe("error");
    expect((await millionVerifierVerifyEmail({}, ctx("key"))).status).toBe("error");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces non-2xx as an error", async () => {
    stubFetch({}, false, 402);
    expect((await millionVerifierVerifyEmail({ email: "a@b.com" }, ctx("key"))).status).toBe("error");
  });
});

describe("Hunter adapter", () => {
  it("finds an email and maps confidence", async () => {
    stubFetch({ data: { email: "owner@acme.com", score: 91, pattern: "{first}" } });
    const result = await hunterFindEmail({ fullName: "Jane Doe", domain: "acme.com" }, ctx("key"));
    expect(result.status).toBe("ok");
    expect(result.data[0]).toMatchObject({ email: "owner@acme.com", confidence: 91, source: "hunter" });
  });

  it("returns empty when no email is found", async () => {
    stubFetch({ data: {} });
    expect((await hunterFindEmail({ fullName: "Jane Doe", domain: "acme.com" }, ctx("key"))).status).toBe("empty");
  });

  it("verifies an email", async () => {
    stubFetch({ data: { result: "deliverable", score: 88 } });
    const result = await hunterVerifyEmail({ email: "owner@acme.com" }, ctx("key"));
    expect(result.data[0]).toMatchObject({ status: "valid", grade: "A" });
  });
});

describe("Apollo adapter", () => {
  it("returns a matched email", async () => {
    stubFetch({ person: { email: "ceo@acme.com", email_confidence: 80 } });
    const result = await apolloFindEmail({ fullName: "Sam Ray", domain: "acme.com" }, ctx("key"));
    expect(result.data[0]).toMatchObject({ email: "ceo@acme.com", source: "apollo" });
  });

  it("returns empty when the email is locked/unavailable", async () => {
    stubFetch({ person: { email: "email_not_unlocked@domain.com" } });
    expect((await apolloFindEmail({ fullName: "Sam Ray", domain: "acme.com" }, ctx("key"))).status).toBe("empty");
  });
});

describe("Apify adapters", () => {
  it("maps Google Maps places to discovered companies", async () => {
    stubFetch([
      { title: "Joe's Auto", website: "https://www.joesauto.com/", phone: "+15551112222", city: "Dallas", state: "TX", countryCode: "US", placeId: "p1", categoryName: "Auto repair" }
    ]);
    const result = await apifyMapsDiscoverCompanies({ query: "auto repair", geographies: ["Dallas, TX"], limit: 10 }, ctx("token"));
    expect(result.status).toBe("ok");
    expect(result.data[0]).toMatchObject({ providerCompanyId: "p1", name: "Joe's Auto", domain: "joesauto.com", phone: "+15551112222", city: "Dallas", country: "US", industry: "Auto repair" });
  });

  it("errors (no call) without an Apify token", async () => {
    const spy = stubFetch([]);
    expect((await apifyMapsDiscoverCompanies({ query: "x" }, ctx(undefined))).status).toBe("error");
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps LinkedIn profiles to discovered contacts", async () => {
    stubFetch([
      { name: "Jane Doe", headline: "VP Sales", companyName: "Acme", linkedinUrl: "https://linkedin.com/in/janedoe", publicIdentifier: "janedoe", location: "Austin, TX" }
    ]);
    const result = await apifyHarvestDiscoverContacts({ titles: ["VP Sales"], geographies: ["United States"] }, ctx("token"));
    expect(result.data[0]).toMatchObject({ providerContactId: "janedoe", fullName: "Jane Doe", title: "VP Sales", companyName: "Acme", linkedinUrl: "https://linkedin.com/in/janedoe" });
  });

  it("returns empty when LinkedIn search yields nothing", async () => {
    stubFetch([]);
    expect((await apifyHarvestDiscoverContacts({ query: "nobody" }, ctx("token"))).status).toBe("empty");
  });
});

describe("ensureLiveProviderAdaptersRegistered", () => {
  it("registers the data-provider operations", () => {
    resetLiveProviderAdapters();
    resetLiveProviderAdapterRegistration();
    expect(getLiveProviderOperation("millionverifier", "verify_email")).toBeUndefined();

    ensureLiveProviderAdaptersRegistered();

    expect(typeof getLiveProviderOperation("millionverifier", "verify_email")).toBe("function");
    expect(typeof getLiveProviderOperation("hunter", "find_email")).toBe("function");
    expect(typeof getLiveProviderOperation("hunter", "verify_email")).toBe("function");
    expect(typeof getLiveProviderOperation("apollo", "find_email")).toBe("function");
    expect(typeof getLiveProviderOperation("apify_maps", "discover_companies")).toBe("function");
    expect(typeof getLiveProviderOperation("apify_harvest", "discover_contacts")).toBe("function");
  });
});
