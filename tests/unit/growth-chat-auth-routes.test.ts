import { describe, expect, it } from "vitest";
import { isChatMachineApiPath } from "@/lib/phase1/auth-routes";

describe("chat M2M proxy boundary", () => {
  it.each([
    "/api/chat/niche-request",
    "/api/approvals/apr_1/decide",
    "/api/approvals/apr_1/revise"
  ])("lets the self-authenticating route receive %s", (pathname) => {
    expect(isChatMachineApiPath(pathname)).toBe(true);
  });

  it.each([
    "/api/approvals",
    "/api/approvals/apr_1",
    "/api/approvals/apr_1/delete",
    "/api/admin/users",
    "/approvals/apr_1/decide"
  ])("does not bypass the session proxy for %s", (pathname) => {
    expect(isChatMachineApiPath(pathname)).toBe(false);
  });
});
