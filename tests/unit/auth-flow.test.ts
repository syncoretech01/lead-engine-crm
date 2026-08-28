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

  // Browsers normalise backslashes in a Location header, so these are
  // protocol-relative URLs: without the guard a crafted ?next= sent the user to
  // an attacker domain immediately AFTER a successful login, from the real
  // login page — the most convincing possible phishing hand-off.
  it("rejects backslash forms that browsers normalise into another origin", () => {
    expect(safeNextPath(String.raw`/\evil.test`)).toBe("/");
    expect(safeNextPath(String.raw`/\\evil.test`)).toBe("/");
    expect(safeNextPath(String.raw`/\evil.test/path?a=b`)).toBe("/");
    expect(safeNextPath(String.raw`/crm/contacts\..\evil.test`)).toBe("/");
    // Ordinary paths are unaffected.
    expect(safeNextPath("/crm/contacts?owner=sam")).toBe("/crm/contacts?owner=sam");
  });
});
