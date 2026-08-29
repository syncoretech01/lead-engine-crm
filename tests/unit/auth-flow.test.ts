import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/phase1/auth-flow";

describe("auth flow helpers", () => {
  it("allows normal in-app post-login destinations", () => {
    expect(safeNextPath("/crm/contacts?owner=sam")).toBe("/crm/contacts?owner=sam");
    expect(safeNextPath("/sdr/queue")).toBe("/sdr/queue");
  });

  it("rejects unsafe or auth-only post-login destinations", () => {
    expect(safeNextPath("https://evil.test")).toBe("/");
    expect(safeNextPath("//evil.test")).toBe("/");
    expect(safeNextPath("/auth/login")).toBe("/");
    expect(safeNextPath("/auth/logout")).toBe("/");
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/reset-password/token")).toBe("/");
    expect(safeNextPath("/invite/token")).toBe("/");
    expect(safeNextPath("/api/import/csv")).toBe("/");
  });

  // A crafted ?next= that escapes the origin sends the user to an attacker domain
  // immediately AFTER a successful login, from the real login page — the most
  // convincing possible phishing hand-off. Two separate character classes get
  // there, and a blacklist of one of them is what shipped first:
  //
  //   backslash  — normalised to "/" by the URL parser
  //   tab/LF/CR  — STRIPPED by the parser before parsing, so "/\t/evil.test"
  //                becomes "//evil.test" while starting with a single "/"
  //
  // safeNextPath resolves the value the way the redirect will and keeps it only
  // if it stayed on-origin, so both classes are covered by construction.
  it("rejects backslash forms the URL parser normalises into another origin", () => {
    expect(safeNextPath(String.raw`/\evil.test`)).toBe("/");
    expect(safeNextPath(String.raw`/\\evil.test`)).toBe("/");
    expect(safeNextPath(String.raw`/\evil.test/path?a=b`)).toBe("/");
  });

  it("rejects tab, LF and CR forms the URL parser strips before parsing", () => {
    expect(safeNextPath("/\t/evil.test")).toBe("/");
    expect(safeNextPath("/\n/evil.test")).toBe("/");
    expect(safeNextPath("/\r/evil.test")).toBe("/");
    expect(safeNextPath("/\r\n/evil.test")).toBe("/");
  });

  it("keeps ordinary destinations intact, including query and hash", () => {
    expect(safeNextPath("/crm/contacts?owner=sam")).toBe("/crm/contacts?owner=sam");
    expect(safeNextPath("/sdr/queue")).toBe("/sdr/queue");
    expect(safeNextPath("/crm/contacts#activity")).toBe("/crm/contacts#activity");
  });

  // The property that actually matters, asserted the way the redirect is built:
  // whatever comes out must resolve back onto this origin.
  it("never yields a value that resolves off-origin", () => {
    const base = "https://app.syncoretech.com";
    const hostile = [
      "//evil.test",
      "https://evil.test",
      String.raw`/\evil.test`,
      String.raw`/\\evil.test`,
      "/\t/evil.test",
      "/\n/evil.test",
      "/\r/evil.test",
      "/crm/contacts?owner=sam"
    ];
    for (const candidate of hostile) {
      const resolved = new URL(safeNextPath(candidate), base);
      expect(resolved.origin, `${JSON.stringify(candidate)} escaped the origin`).toBe(base);
    }
  });
});
