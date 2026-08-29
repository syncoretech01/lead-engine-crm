import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every server action must be authorized — enforced structurally, not by review.
 *
 * `app/actions.ts` alone exports 93 actions and has no direct test coverage; the
 * whole mutation surface of the live CRM is reachable from a browser by any
 * signed-in user. One action shipped without a permission gate is one SDR able to
 * mutate another SDR's book, or the legacy workspace, with nothing to catch it —
 * the e2e specs that touch these paths run in the advisory lane.
 *
 * This sweep reads the source rather than invoking the actions: they resolve
 * their session from request cookies, so calling them in a unit test fails for
 * the wrong reason (no request context) and would prove nothing about
 * authorization. Same approach as scripts/check-projection-invariant.mjs — the
 * check that matters is "did somebody forget the gate", and that is visible in
 * the text.
 *
 * A new action with no recognised gate fails this test. The escape hatch is the
 * allowlist below, which requires writing down WHY — so an exception is a
 * decision somebody made on purpose, not an omission nobody noticed.
 */

const ACTION_FILES = [
  "app/actions.ts",
  "app/auth/actions.ts",
  "app/settings/actions.ts",
  "app/approvals/actions.ts",
  "app/enrichment/live-actions.ts"
];

/**
 * Call shapes that constitute a gate.
 *
 * `assertPermission` and `getWorkspaceSessionContext(<permission>)` are the
 * primary ones. The rest are helpers that assert internally and are verified by
 * their own tests: the CRM mutation guards resolve and check the acting user
 * against the record's owner.
 */
const GATE_PATTERNS = [
  /\bassertPermission\s*\(/,
  /\bgetWorkspaceSessionContext\s*\(\s*["']/,
  /\bassertAssignedContactForOutreach\s*\(/,
  /\bresolveCrmMutationUserId\s*\(/,
  /\bassertCrmMutationAllowed\s*\(/,
  // Explicit role checks inside the write transaction. Weaker than the
  // permission table (see the allowlist note on updateContactDetailsAction) but
  // unambiguously a gate.
  /session\.role\s*!==\s*["']Admin["']/
];

/**
 * Modules an action may delegate its gate to. Most actions in app/auth/actions.ts
 * are thin wrappers over a `*PrismaFast` helper or a service function that
 * asserts inside its own transaction, so the sweep resolves ONE level of
 * delegation before calling an action ungated — otherwise the allowlist would
 * swallow most of the auth surface and stop meaning anything.
 */
const DELEGATE_MODULES = [
  "lib/phase1/auth-fast-path.ts",
  "lib/phase1/auth-service.ts",
  "lib/phase1/provider-connections.ts",
  "lib/phase1/provider-connection-service.ts",
  "lib/phase1/tile-layouts.ts",
  "lib/growth/approval-orchestration.ts"
];

/** Gate shapes that only appear in delegates, not in action bodies. */
const DELEGATE_GATE_PATTERNS = [...GATE_PATTERNS, /\brequireManageWorkspaceSessionFast\s*\(/];

/**
 * Actions that are deliberately not gated anywhere in that chain. Each entry
 * states the reason; adding one without a reason is the point of failure.
 */
const ALLOWED_UNGATED: Record<string, string> = {
  // PRE-AUTH BY DESIGN. These are how a caller obtains or recovers a session, so
  // requiring a permission would make them unusable. Their protection is rate
  // limiting plus single-use, expiring, hashed tokens — not a permission gate.
  loginAction: "pre-auth: this is how a session is obtained; rate limited, generic failure message",
  acceptInviteAction: "pre-auth: redeems a hashed single-use invite token, which is the authorization",
  requestPasswordResetAction: "pre-auth: rate limited, and reveals nothing about whether the email exists",
  resetPasswordAction: "pre-auth: redeems a hashed single-use, expiring reset token",

  // SELF-SCOPED. Reach is limited to the caller's own row by construction, so
  // there is no cross-user or cross-workspace access to gate.
  logoutAction: "self-scoped: revokes only the caller's own session, identified from their cookie",
  switchWorkspaceAction:
    "self-scoped: changes the caller's own session, and both implementations verify membership of the target workspace",
  saveTileLayoutAction: "self-scoped: writes only session.user.id's own dashboard tile layout",
  resetTileLayoutAction: "self-scoped: clears only session.user.id's own dashboard tile layout",
  updateProfileAction:
    "self-scoped: updateOwnProfile resolves its target from session.user.id, so a caller can only edit their own name/signature/timezone",
  changePasswordAction:
    "self-scoped: changeOwnPassword resolves its target from session.user.id and re-verifies the CURRENT password before setting a new one"
};

/**
 * Comments are not code. Without this the sweep matched the word
 * `assertPermission` inside auth-service.ts's own note that a function
 * "intentionally omits an assertPermission gate" — reporting the exact opposite
 * of the truth. It also means nobody can satisfy this check by writing the magic
 * word in a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

type ActionFn = { name: string; file: string; exported: boolean; body: string };

/**
 * Every top-level function in a file, with its body.
 *
 * Boundaries come from ALL function declarations, exported or not. Splitting only
 * on `export function` made the last exported function's body run to end-of-file
 * and swallow the next (unexported) function — which made `changePasswordAction`
 * read as gated because an `assertPermission` belonging to a completely different
 * function fell inside its slice. A false "gated" is the dangerous direction for
 * this check, so the boundaries have to be right.
 */
function topLevelFunctions(file: string): ActionFn[] {
  const absolute = path.resolve(__dirname, "../..", file);
  const lines = readFileSync(absolute, "utf8").split(/\r?\n/);
  const starts: Array<{ name: string; exported: boolean; line: number }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (match) starts.push({ name: match[2], exported: Boolean(match[1]), line: index });
  });
  return starts.map((start, index) => ({
    name: start.name,
    file,
    exported: start.exported,
    body: lines.slice(start.line, starts[index + 1]?.line ?? lines.length).join("\n")
  }));
}

const allActions = ACTION_FILES.flatMap(topLevelFunctions).filter(
  // Server actions are the exported async functions; local helpers are not part
  // of the reachable surface.
  (fn) => fn.exported && /^export\s+async\s+function/.test(fn.body)
);

/** name → body, for every exported function in the delegate modules. */
const delegateBodies = new Map<string, string>(
  DELEGATE_MODULES.flatMap(topLevelFunctions)
    .filter((fn) => fn.exported)
    .map((fn) => [fn.name, fn.body] as const)
);

/**
 * Gated directly, or through the delegate chain.
 *
 * Depth 2 because the provider actions delegate twice: the action calls
 * `saveProviderConnection` (a thin updateState wrapper), which calls
 * `saveProviderConnectionConfig`, which is where assertPermission lives.
 */
function isGated(source: string, depth = 2): boolean {
  const code = stripComments(source);
  if (DELEGATE_GATE_PATTERNS.some((pattern) => pattern.test(code))) return true;
  if (depth <= 0) return false;
  for (const [name, body] of delegateBodies) {
    // Word-boundary call match, so `foo(` does not match `notFoo(`.
    if (!new RegExp(`\\b${name}\\s*\\(`).test(code)) continue;
    if (isGated(body, depth - 1)) return true;
  }
  return false;
}

describe("server action authorization sweep", () => {
  it("finds the action surface it is supposed to be guarding", () => {
    // A refactor that moves actions out of these files must update ACTION_FILES,
    // or this sweep silently guards a shrinking surface.
    expect(allActions.length).toBeGreaterThan(100);
    expect(allActions.filter((action) => action.file === "app/actions.ts").length).toBeGreaterThan(80);
  });

  it("gates every exported action, or names it in the allowlist with a reason", () => {
    const ungated = allActions
      .filter((action) => !isGated(action.body))
      .filter((action) => !(action.name in ALLOWED_UNGATED))
      .map((action) => `${action.file} → ${action.name}`);

    expect(
      ungated,
      "these server actions have no permission gate and are not allowlisted — add assertPermission, " +
        "or add an entry to ALLOWED_UNGATED explaining why the action is safe without one"
    ).toEqual([]);
  });

  it("keeps the allowlist honest — no stale entries", () => {
    const names = new Set(allActions.map((action) => action.name));
    const stale = Object.keys(ALLOWED_UNGATED).filter((name) => !names.has(name));
    expect(stale, "allowlisted actions that no longer exist — delete these entries").toEqual([]);

    // An allowlisted action that HAS since gained a real gate should leave the
    // allowlist, so the list keeps meaning "deliberately ungated".
    const nowGated = Object.keys(ALLOWED_UNGATED).filter((name) => {
      const action = allActions.find((candidate) => candidate.name === name);
      return action ? isGated(action.body) : false;
    });
    expect(nowGated, "these are allowlisted but now gate themselves — remove them from ALLOWED_UNGATED").toEqual(
      []
    );
  });

  it("requires a written reason for every exception", () => {
    for (const [name, reason] of Object.entries(ALLOWED_UNGATED)) {
      expect(reason.trim().length, `${name} needs a real reason, not a placeholder`).toBeGreaterThan(20);
    }
  });
});
