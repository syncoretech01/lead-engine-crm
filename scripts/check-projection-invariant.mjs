/**
 * CRM-0 GUARDRAIL — the projection invariant.
 * ============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * App state is one JSON blob (`AppStateSnapshot`) projected onto ~70 tables.
 * `lib/phase1/persistence-projection.ts:1599` runs, for every workspaceScoped
 * entry in `upsertOrder`, once per workspace, on every projection sync:
 *
 *     await delegate.deleteMany({ where: { workspaceId, id: { notIn: ids } } });
 *
 * Any table reachable from `upsertOrder` therefore LOSES EVERY ROW that is not
 * present in the blob. Growth OS models are Prisma-native — they are written by
 * transactional repositories and never appear in the blob — so the moment one is
 * added to the projection "for consistency", the next sync silently destroys the
 * entire table. No error, no exception, no log line. Just an empty table.
 *
 * That is the most expensive failure available in this repo, and it is a
 * one-line mistake. This check makes it impossible to merge.
 *
 * Golden rule 1: blob-projected XOR Prisma-native. Never both.
 *
 * WHAT IT DOES
 * ------------
 * Fails (exit 1) if any guarded Growth OS model name appears anywhere in
 * `lib/phase1/persistence-projection.ts`.
 *
 * MATCHING RULES — read before changing anything here
 * ---------------------------------------------------
 * A false negative silently destroys production data. A false positive costs
 * someone a minute. Every rule below is therefore deliberately biased toward
 * over-reporting.
 *
 *  1. FOUR SURFACE FORMS PER MODEL. This is the rule that actually matters.
 *     `upsertOrder` entries are camelCase, not PascalCase:
 *
 *         { table: "campaignSequences", delegate: "campaignSequence", ... }
 *
 *     So a real violation reads `{ table: "campaignStageRuns", delegate:
 *     "campaignStageRun" }` — which contains NO `CampaignStageRun` substring at
 *     a word boundary. Matching PascalCase alone would be a false negative for
 *     the exact mistake this check exists to catch. We therefore derive and
 *     match all of:
 *         PascalCase          CampaignStageRun
 *         camelCase singular  campaignStageRun
 *         camelCase plural    campaignStageRuns
 *         PascalCase plural   CampaignStageRuns
 *
 *  2. TWO-TIER CONTEXT. PascalCase forms match ANYWHERE — they are type/model
 *     names and no legitimate local ever collides. camelCase forms match only in
 *     STRUCTURAL positions:
 *         quoted string     "campaigns"        ← table:/delegate: values
 *         object key        campaigns:         ← projection object keys
 *         property access   .campaigns         ← state.campaigns
 *
 *     Why: the first draft matched camelCase anywhere and reported 31 false
 *     positives on a clean tree — every one of them the lambda parameter in the
 *     legitimate, blob-projected `state.outreachCampaigns.map((campaign) => ...)`.
 *     A bare identifier in expression position is a local variable and is
 *     harmless. A quoted string, an object key, or a property access is how a
 *     table actually enters the projection. Restricting to those three loses no
 *     real coverage — a model cannot reach `deleteMany` without appearing in at
 *     least one of them — and it keeps the check credible enough to survive.
 *     A check that cries wolf gets deleted, which is strictly worse than no check.
 *
 *  3. WORD-BOUNDARY (`\b...\b`) and CASE-SENSITIVE. `Campaign` must not fire on
 *     the pre-existing, legitimate `outreachCampaigns` / `campaignSequences`
 *     entries — in both, the guarded word is glued to another word character, so
 *     no boundary exists. And `campaignSequences` (legitimate, blob-projected)
 *     must not be confused with `CampaignStageRun` (Growth OS, native). Case
 *     carries real meaning here, so we honour it.
 *
 *  4. NO COMMENT STRIPPING AND NO ESCAPE HATCH — intentional. Comments are
 *     scanned exactly like code. There is no `// allow` pragma, because every
 *     escape hatch eventually gets used on the one line that mattered. The
 *     consequence: if you want to warn future maintainers inside
 *     persistence-projection.ts, DO NOT NAME the guarded models. Write
 *     "see scripts/check-projection-invariant.mjs for the guarded list" instead.
 *     Adjust the comment, never the guard.
 *
 * ADDING A FUTURE GROWTH OS MODEL
 * -------------------------------
 * One line in GUARDED_MODELS below. That array is the single source of truth;
 * surface forms are derived, never hand-written. tests/projection-invariant.test.ts
 * asserts the list still contains every model from Plan v9.1 §6, so entries
 * cannot be silently dropped.
 *
 * RUN IT
 * ------
 *     npm run check:projection-invariant
 *
 * Zero dependencies (node: builtins only) so CI can run it without `npm ci`,
 * and its verdict can never be masked by an unrelated install/lint/type failure.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every Growth OS model that must stay Prisma-native (Plan v9.1 §6).
 * ONE LINE PER MODEL — this is the single source of truth.
 */
export const GUARDED_MODELS = [
  // Request & research
  "NicheRequest",
  "ResearchRun",
  "NicheBrief",
  // Campaign & execution
  "Campaign",
  "CampaignStageRun",
  "CostEntry",
  // Approvals
  "Approval",
  "ProviderRunProposal",
  // Audit (factual) & assets
  "AuditRun",
  "AuditFinding",
  "AuditAsset",
  // Personalization
  "PersonalizationProfile",
  "PersonalizationRun",
  "MessageTemplate",
  "MessageTemplateVersion",
  "GeneratedMessage",
  "CopyQaResult",
  "PersonalizationSampleSet",
  // Engagement, eligibility, sync
  "EngagementEvent",
  "CampaignEligibilityPolicy",
  "HubSync"
];

/** The file the invariant protects, relative to the repo root. */
export const PROJECTION_FILE = "lib/phase1/persistence-projection.ts";

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** English-enough pluralisation for identifier names. See rule 1. */
function pluralize(word) {
  const lower = word.toLowerCase();
  if (lower.endsWith("y") && !VOWELS.has(lower.at(-2) ?? "")) {
    // CostEntry -> costEntries, CampaignEligibilityPolicy -> ...Policies
    return `${word.slice(0, -1)}ies`;
  }
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${word}es`;
  return `${word}s`;
}

const lowerFirst = (word) => word.charAt(0).toLowerCase() + word.slice(1);

/**
 * The four spellings a model can wear in this codebase (rule 1).
 * Derived, never hand-written — so a new model gets full coverage for free.
 */
export function surfaceFormsFor(model) {
  const camel = lowerFirst(model);
  return [...new Set([model, camel, pluralize(camel), pluralize(model)])];
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isPascalCase = (form) => /^[A-Z]/.test(form);

/**
 * Build the matcher for one surface form, applying the two-tier rule (rule 2).
 * Always case-sensitive and word-bounded (rule 3).
 */
export function patternFor(form) {
  const safe = escapeRegExp(form);

  // Tier 1 — PascalCase: a type/model name. Match anywhere.
  if (isPascalCase(form)) return new RegExp(`\\b${safe}\\b`, "g");

  // Tier 2 — camelCase: only where a table actually enters the projection.
  return new RegExp(
    [
      `["']${safe}["']`, //        quoted:   table: "campaigns"
      `(?:^|[{,])\\s*${safe}\\b\\s*:`, // key:      campaigns: sortRows(...)
      `\\.${safe}\\b` //           property: state.campaigns
    ].join("|"),
    "g"
  );
}

/**
 * Scan source text for guarded names.
 * Pure and exported so the meta-test can prove the matcher is not a no-op.
 *
 * @returns {Array<{model: string, form: string, line: number, column: number, text: string}>}
 */
export function findViolations(source, models = GUARDED_MODELS) {
  const violations = [];
  const lines = source.split(/\r?\n/);

  for (const model of models) {
    for (const form of surfaceFormsFor(model)) {
      const pattern = patternFor(form);
      lines.forEach((text, index) => {
        for (const match of text.matchAll(pattern)) {
          violations.push({
            model,
            form,
            line: index + 1,
            column: (match.index ?? 0) + 1,
            text: text.trim()
          });
        }
      });
    }
  }

  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const target = join(repoRoot, PROJECTION_FILE);

  let source;
  try {
    source = readFileSync(target, "utf8");
  } catch (error) {
    // A missing/renamed target would make this check vacuously pass. Fail loudly.
    console.error(`✗ projection invariant: cannot read ${PROJECTION_FILE}`);
    console.error(`  ${error.message}`);
    console.error("  If the file moved, update PROJECTION_FILE in this script.");
    process.exit(1);
  }

  const violations = findViolations(source);

  if (violations.length === 0) {
    console.log(
      `✓ projection invariant: ${PROJECTION_FILE} is free of all ` +
        `${GUARDED_MODELS.length} guarded Growth OS models.`
    );
    return;
  }

  console.error(
    `✗ projection invariant VIOLATED — ${violations.length} ` +
      `occurrence${violations.length === 1 ? "" : "s"} in ${PROJECTION_FILE}:\n`
  );
  for (const violation of violations) {
    console.error(`  ${PROJECTION_FILE}:${violation.line}:${violation.column}`);
    console.error(`    matched "${violation.form}" (guarded model: ${violation.model})`);
    console.error(`    ${violation.text}\n`);
  }
  console.error(
    "Growth OS models are Prisma-native. Adding one to this file puts it in\n" +
      "upsertOrder's blast radius: persistence-projection.ts:1599 runs\n" +
      "deleteMany({ where: { workspaceId, id: { notIn: ids } } }) per table, and\n" +
      "the table is emptied on the next sync — silently.\n\n" +
      "Fix: remove it from the projection. Give it a transactional repository\n" +
      "instead (see lib/phase1/auth-fast-path.ts). Never widen this check to\n" +
      "make a violation pass."
  );
  process.exit(1);
}

// Only run when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
