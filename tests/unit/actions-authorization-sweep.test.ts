import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

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

/**
 * Discovered, not listed.
 *
 * A hand-maintained list guards a surface that only ever shrinks: it catches a
 * file being emptied, but a NEWLY created "use server" module is invisible to it
 * forever — which is the exact failure this whole sweep exists to prevent, one
 * level up. Every file carrying the directive exposes each of its exported async
 * functions as a callable endpoint, so the directive is the definition of the
 * surface and the sweep reads it directly.
 */
function serverActionFiles(): string[] {
  const roots = ["app", "lib", "components"];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        // The directive must be the first statement, so only the head matters.
        const head = readFileSync(full, "utf8").slice(0, 200);
        if (/^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use server["']/.test(head)) {
          found.push(path.relative(repoRoot, full).split(path.sep).join("/"));
        }
      }
    }
  };
  for (const root of roots) walk(path.join(repoRoot, root));
  return found.sort();
}

const ACTION_FILES = serverActionFiles();

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
  // The blob-store twin of the above (store.ts:270): it redirects away rather
  // than throwing, which inside a server action means a NEXT_REDIRECT that
  // aborts before any write. Only counts WITH a permission argument — called
  // bare it resolves a session and authorizes nothing.
  /\bgetWorkspaceContext\s*\(\s*["']/,
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
  "lib/growth/approval-orchestration.ts",
  // The provider job actions are updateState wrappers whose callback is the
  // gate: createProviderExecutionJob delegates to createProviderJob, which
  // asserts manage_workspace inside the transaction (provider-jobs.ts:62).
  "lib/phase1/provider-jobs.ts"
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

type DeclKind = "yes" | "no" | "unknown";

type ActionFn = {
  name: string;
  file: string;
  exported: boolean;
  /**
   * Whether this declaration is an async function in any of its forms — in a
   * `"use server"` file that is what makes it a callable endpoint. `unknown`
   * means the classifier could not tell, which fails the suite rather than
   * quietly excusing the declaration from the check.
   */
  kind: DeclKind;
  line: number;
  body: string;
};

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
/**
 * Is the declaration starting at `index` an async function, in any form?
 *
 * Three-valued on purpose. `export const x = async () => {}` can be wrapped so
 * the `async` lands on the next line, and an initialiser can also be an
 * expression whose asyncness is not visible at all (`= wrap(async () => {})`).
 * Both of those are RECOGNISED as declarations, so neither is reported as
 * unparseable — and if "not obviously async" silently meant "not an action",
 * they would fall through the classifier and the unknown-form net at once,
 * which is how the first version of this fix still let an ungated action
 * through.
 *
 * So: `async` is yes, a plain arrow or `function` is no, and anything else an
 * exported declaration might be is `unknown` — which fails the suite rather
 * than being skipped. The look-ahead is capped so a malformed file cannot walk
 * the whole source.
 */
function declaresAsync(lines: string[], index: number): "yes" | "no" | "unknown" {
  const first = lines[index];
  if (/^(?:export\s+)?(?:default\s+)?async\s/.test(first)) return "yes";
  if (/^(?:export\s+)?(?:default\s+)?function\b/.test(first)) return "no";
  if (!/^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s/.test(first)) return "no";

  let text = first;
  for (let ahead = 1; ahead <= 3 && !/=>|\bfunction\b|\basync\b/.test(text); ahead += 1) {
    text += ` ${lines[index + ahead] ?? ""}`;
  }
  if (!text.includes("=")) return "unknown";
  const initialiser = text.slice(text.indexOf("=") + 1);
  if (/^\s*async\b/.test(initialiser)) return "yes";
  // A sync function, or a plain value: neither is a callable server action.
  if (/^\s*(?:\(|function\b|[\w$]+\s*=>)/.test(initialiser)) return "no";
  if (/^\s*(?:["'`]|\d|\{|\[|new\s|true\b|false\b|null\b)/.test(initialiser)) return "no";
  return "unknown";
}

function topLevelFunctions(file: string): ActionFn[] {
  const absolute = path.resolve(__dirname, "../..", file);
  const lines = readFileSync(absolute, "utf8").split(/\r?\n/);
  const starts: Array<{ name: string; exported: boolean; kind: DeclKind; line: number }> = [];
  lines.forEach((line, index) => {
    // ANY top-level declaration ends the previous body, not just `function`.
    // Splitting on `function` alone let a body run into a following
    // `export const foo = async () => {}` and inherit that function's gate.
    const match = line.match(/^(export\s+)?(?:default\s+)?(?:async\s+)?(function|const|let|var|class)\s+(\w+)/);
    if (!match) return;
    starts.push({
      name: match[3],
      exported: Boolean(match[1]),
      // `async` sits before the keyword in `export async function foo`, but
      // AFTER the `=` in `export const foo = async () => {}`. Testing only the
      // first form is what made two thirds of the legal action syntaxes
      // invisible to this sweep.
      //
      // The initialiser can also be wrapped onto the next line, which is the
      // form that slipped through the first fix: the declaration was RECOGNISED
      // (so it was not reported as unclassifiable) but read as non-async (so it
      // was not checked either) — skipped by both nets at once.
      kind: declaresAsync(lines, index),
      line: index
    });
  });
  return starts.map((start, index) => ({
    ...start,
    file,
    body: lines.slice(start.line, starts[index + 1]?.line ?? lines.length).join("\n")
  }));
}

/**
 * Exported lines this file's classifier does not understand.
 *
 * The sweep's whole value is that it cannot be quietly bypassed, so a form it
 * has never seen must fail rather than be skipped: skipping is indistinguishable
 * from "no such action exists", which is the failure mode one level up. Type-only
 * exports are erased at compile time and expose nothing; a re-export alias is
 * covered by whatever gates the function it aliases, but only if that function is
 * declared in this same file where the sweep can actually see it.
 */
function unclassifiedExports(file: string): string[] {
  const absolute = path.resolve(repoRoot, file);
  const lines = readFileSync(absolute, "utf8").split(/\r?\n/);
  const declared = new Map(topLevelFunctions(file).map((fn) => [fn.line, fn] as const));
  const localNames = new Set(topLevelFunctions(file).map((fn) => fn.name));

  return lines.flatMap((line, index) => {
    if (!/^export\s/.test(line)) return [];
    if (/^export\s+(?:type|interface)\s/.test(line)) return [];
    const declaration = declared.get(index);
    // Recognised as a declaration AND classified: nothing to report. Recognised
    // but unclassifiable falls through to the report below, so it cannot be
    // silently skipped by both this net and the action filter.
    if (declaration && !(declaration.exported && declaration.kind === "unknown")) return [];
    const alias = line.match(/^export\s*\{\s*(\w+)\s+as\s+\w+\s*\}/);
    if (alias && localNames.has(alias[1])) return [];
    return [`${file}:${index + 1} → ${line.trim()}`];
  });
}

/**
 * The callable surface: every exported async function, in any form.
 *
 * Was `/^export\s+async\s+function/`, which is only ONE of the three ways to
 * declare a server action. Review demonstrated the hole by appending an ungated
 * `export const dangerousArrowAction = async () => {…}` to app/actions.ts and
 * watching this suite stay green.
 */
const allActions = ACTION_FILES.flatMap(topLevelFunctions).filter((fn) => fn.exported && fn.kind === "yes");

/** Every exported function in the cross-module delegates: name → body. */
const exportedDelegates: ActionFn[] = DELEGATE_MODULES.flatMap(topLevelFunctions).filter((fn) => fn.exported);

/**
 * Same-file helpers, resolved per file — never globally.
 *
 * Plenty of actions are a two-line dispatcher over a local helper that holds the
 * gate: searchCrmRecordsAction branches into `searchViaPrisma`, and the five
 * waterfall template actions all call `findEditableTemplate`, which is not even
 * exported. Treating those as ungated would mean five allowlist entries whose
 * stated reason is "the sweep cannot see one function call", which devalues
 * every real entry next to them.
 *
 * Keyed by file because a global name index would let a gated `findTemplate` in
 * one module vouch for an ungated same-named helper in another — the sweep would
 * report a gate that does not exist on that path. Local means local.
 */
const localFunctions = new Map<string, ActionFn[]>();
for (const file of [...ACTION_FILES, ...DELEGATE_MODULES]) {
  localFunctions.set(file, topLevelFunctions(file));
}

/**
 * Gated directly, or through the delegate chain.
 *
 * Depth 2 because the provider actions delegate twice: the action calls
 * `saveProviderConnection` (a thin updateState wrapper), which calls
 * `saveProviderConnectionConfig`, which is where assertPermission lives.
 */
function isGated(source: string, file: string, depth = 2): boolean {
  const code = stripComments(source);
  if (DELEGATE_GATE_PATTERNS.some((pattern) => pattern.test(code))) return true;
  if (depth <= 0) return false;

  const candidates = [...(localFunctions.get(file) ?? []), ...exportedDelegates];
  for (const candidate of candidates) {
    if (candidate.body === source) continue; // don't recurse into itself
    // Word-boundary call match, so `foo(` does not match `notFoo(`.
    if (!new RegExp(`\\b${candidate.name}\\s*\\(`).test(code)) continue;
    if (isGated(candidate.body, candidate.file, depth - 1)) return true;
  }
  return false;
}

describe("server action authorization sweep", () => {
  it("finds the action surface it is supposed to be guarding", () => {
    // Tight floors, close to the real 136 / 93. Loose ones (>100 / >80) left
    // enough slack to delete every action in app/auth/actions.ts and both
    // waterfall services while still passing — a surface guard with 36 rows of
    // give is not guarding the surface.
    expect(allActions.length).toBeGreaterThanOrEqual(130);
    expect(allActions.filter((action) => action.file === "app/actions.ts").length).toBeGreaterThanOrEqual(90);
  });

  it("understands every export in a use-server file", () => {
    // An export form the classifier does not recognise is silently skipped, and
    // a skipped action is indistinguishable from a gated one in the result. If
    // this fails, teach the classifier the form — do not add it to the
    // allowlist, which is for actions that ARE seen and ARE deliberately open.
    const unknown = ACTION_FILES.flatMap(unclassifiedExports);
    expect(
      unknown,
      "these exports are in a \"use server\" file but the sweep cannot classify them, so it is not checking them"
    ).toEqual([]);
  });

  it("gates every exported action, or names it in the allowlist with a reason", () => {
    const ungated = allActions
      .filter((action) => !isGated(action.body, action.file))
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
      return action ? isGated(action.body, action.file) : false;
    });
    expect(nowGated, "these are allowlisted but now gate themselves — remove them from ALLOWED_UNGATED").toEqual(
      []
    );
  });

  /**
   * The sweep is only worth its green tick if it can still go red, and the
   * dangerous direction is a FALSE gate — an ungated action reported as safe.
   * Both cases below produced exactly that during development.
   */
  it("does not accept a gate that is only mentioned in a comment", () => {
    expect(isGated("// assertPermission(session, \"manage_crm\");\nreturn 1;", "app/actions.ts")).toBe(false);
    expect(isGated("/* assertPermission(session, \"manage_crm\"); */\nreturn 1;", "app/actions.ts")).toBe(false);
  });

  it("resolves local helpers only within their own file", () => {
    // findEditableTemplate is a private helper that asserts manage_waterfalls,
    // and the five template actions rely on it — so from inside its own file a
    // call to it IS a gate.
    const call = "findEditableTemplate(state, session, templateId);";
    expect(isGated(call, "lib/phase1/waterfall-template-service.ts")).toBe(true);

    // ...and from anywhere else it is not. A global name index would let this
    // helper vouch for an identically named, ungated helper in another module,
    // which is the false-gate this scoping exists to prevent.
    expect(isGated(call, "app/actions.ts")).toBe(false);
  });

  it("requires a written reason for every exception", () => {
    for (const [name, reason] of Object.entries(ALLOWED_UNGATED)) {
      expect(reason.trim().length, `${name} needs a real reason, not a placeholder`).toBeGreaterThan(20);
    }
  });
});
