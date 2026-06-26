import { describe, expect, it } from "vitest";
import { isPublicAuthPath } from "@/lib/phase1/auth-routes";

describe("auth route allowlist", () => {
  it("allows public auth pages and stable auth form handlers", () => {
    expect(isPublicAuthPath("/login")).toBe(true);
    expect(isPublicAuthPath("/reset-password")).toBe(true);
    expect(isPublicAuthPath("/reset-password/token")).toBe(true);
    expect(isPublicAuthPath("/invite/token")).toBe(true);
    expect(isPublicAuthPath("/auth/login")).toBe(true);
    expect(isPublicAuthPath("/auth/logout")).toBe(true);
    expect(isPublicAuthPath("/auth/accept-invite")).toBe(true);
    expect(isPublicAuthPath("/auth/request-password-reset")).toBe(true);
    expect(isPublicAuthPath("/auth/reset-password")).toBe(true);
  });

  it("keeps unrelated auth-looking paths private", () => {
    expect(isPublicAuthPath("/auth")).toBe(false);
    expect(isPublicAuthPath("/auth/actions")).toBe(false);
    expect(isPublicAuthPath("/auth/provider-settings")).toBe(false);
  });
});
