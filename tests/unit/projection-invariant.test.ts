import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUARDED_MODELS,
  PROJECTION_FILE,
  findViolations,
  surfaceFormsFor
} from "../../scripts/check-projection-invariant.mjs";

/**
 * META-TEST for the CRM-0 projection-invariant guardrail.
 *
 * The guardrail's failure mode is not "it breaks loudly" — it is "it quietly
 * stops matching anything and reports success forever". That is indistinguishable
 * from a clean repo right up until a Growth OS table is added to the projection
 * and `persistence-projection.ts:1599` empties it on the next sync.
 *
 * So these tests assert the check is still ARMED, not merely that it runs:
 *   1. the guarded list still holds every model from Plan v9.1 §6 (nothing dropped)
 *   2. the matcher fires on a realistic violation for EVERY guarded model
 *   3. it fires on PascalCase type references too
 *   4. it does NOT fire on the legitimate blob-projected tables (pins the
 *      two-tier context rule that stopped 31 false positives)
 *   5. the real file is clean right now
 *
 * If you are here because test 4 failed after "simplifying" the matcher to plain
 * substring matching: don't. Read the matching rules in the script header.
 */

/**
 * The Growth OS object model, Plan v9.1 §6. Hard-coded here on purpose: this is a
 * second, independent copy so that deleting a model from GUARDED_MODELS fails CI
 * instead of silently shrinking the guard's blast radius.
 */
const V9_1_GROWTH_OS_MODELS = [
  "NicheRequest",
  "ResearchRun",
  "NicheBrief",
  "Campaign",
  "CampaignStageRun",
  "CostEntry",
  "Approval",
  "ProviderRunProposal",
  "AuditRun",
  "AuditFinding",
  "AuditAsset",
  "PersonalizationProfile",
  "PersonalizationRun",
  "MessageTemplate",
  "MessageTemplateVersion",
  "GeneratedMessage",
  "CopyQaResult",
  "PersonalizationSampleSet",
  "EngagementEvent",
  "CampaignEligibilityPolicy",
  "HubSync"
];

/**
 * Growth OS tables added by later phases that v9.1 §6 does not name.
 *
 * Kept separate from the list above so the two assertions say different things:
 * every v9.1 model must still be guarded (dropping one is a silent loss of
 * protection), and the total list must be exactly v9.1 plus these (adding one
 * requires editing this file, which is the deliberate step).
 */
const LATER_PHASE_ADDITIONS = [
  /** CRM-1. Implements v9.1 §19's "a missed notify is retried". */
  "NotifyOutbox"
];

const repoRoot = path.resolve(__dirname, "../..");

describe("projection invariant — guarded list", () => {
  it("still guards every Growth OS model from Plan v9.1 §6", () => {
    // A missing entry is a silent loss of protection for that table.
    for (const model of V9_1_GROWTH_OS_MODELS) {
      expect(GUARDED_MODELS, `${model} is no longer guarded`).toContain(model);
    }
  });

  it("guards exactly v9.1 §6 plus the recorded later-phase additions", () => {
    // Adding a model to the guard therefore requires editing this file too,
    // which is the deliberate step that keeps the list honest.
    expect([...GUARDED_MODELS].sort()).toEqual(
      [...V9_1_GROWTH_OS_MODELS, ...LATER_PHASE_ADDITIONS].sort()
    );
  });

  it("derives four surface forms, including the camelCase ones upsertOrder uses", () => {
    // The whole point: `{ table: "campaignStageRuns", delegate: "campaignStageRun" }`
    // contains no PascalCase `CampaignStageRun`. Matching PascalCase alone would
    // be a false negative for the exact mistake this check exists to catch.
    expect(surfaceFormsFor("CampaignStageRun")).toEqual(
      expect.arrayContaining([
        "CampaignStageRun",
        "campaignStageRun",
        "campaignStageRuns",
        "CampaignStageRuns"
      ])
    );
  });

  it("pluralizes -y models correctly", () => {
    expect(surfaceFormsFor("CostEntry")).toContain("costEntries");
    expect(surfaceFormsFor("CampaignEligibilityPolicy")).toContain(
      "campaignEligibilityPolicies"
    );
  });
});

describe("projection invariant — the matcher is armed", () => {
  // A no-op matcher passes every "is the file clean?" test. These are the ones
  // that actually prove it can still detect a violation.
  it.each(GUARDED_MODELS)(
    "detects %s added to upsertOrder in the real entry shape",
    (model) => {
      const camel = model.charAt(0).toLowerCase() + model.slice(1);
      const plural = surfaceFormsFor(model).find(
        (form) => form.startsWith(camel) && form !== camel
      );
      const line = `  { table: "${plural}", delegate: "${camel}", workspaceScoped: true },`;

      const violations = findViolations(line);

      expect(violations.length).toBeGreaterThan(0);
      expect(violations.every((violation) => violation.model === model)).toBe(true);
    }
  );

  it("detects a PascalCase type reference anywhere in the file", () => {
    const violations = findViolations(
      'import type { CampaignStageRun } from "@prisma/client";'
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.model).toBe("CampaignStageRun");
  });

  it("detects a projection object key", () => {
    const violations = findViolations("  approvals: sortRows(state.approvals.map((row) => ({");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.model).toBe("Approval");
  });

  it("reports the line and column of a violation", () => {
    const source = ["const a = 1;", "", '  { table: "hubSyncs", delegate: "hubSync" },'].join(
      "\n"
    );
    const violations = findViolations(source);
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.column).toBeGreaterThan(0);
  });
});

describe("projection invariant — no false positives on legitimate tables", () => {
  // These lines are real, current, correct code. A matcher that flags them gets
  // weakened or deleted by the next person, which is worse than no matcher.
  it("ignores the blob-projected outreachCampaigns mapping", () => {
    const source = [
      "  outreachCampaigns: sortRows(state.outreachCampaigns.map((campaign) => ({",
      "    id: campaign.id,",
      "    workspaceId: campaign.workspaceId,",
      "    campaignType: campaign.campaignType,",
      "    meetingsBooked: campaign.meetingsBooked,",
      "  })))"
    ].join("\n");

    expect(findViolations(source)).toEqual([]);
  });

  it("ignores the blob-projected campaignSequences upsertOrder entry", () => {
    const source = '  { table: "campaignSequences", delegate: "campaignSequence", workspaceScoped: true },';
    expect(findViolations(source)).toEqual([]);
  });

  it("ignores campaignId foreign-key references", () => {
    const source =
      "    campaignId: state.outreachCampaigns.some((campaign) => campaign.id === event.campaignId) ? event.campaignId : undefined,";
    expect(findViolations(source)).toEqual([]);
  });
});

describe("projection invariant — the real file", () => {
  it("is free of every guarded Growth OS model", () => {
    const source = readFileSync(path.join(repoRoot, PROJECTION_FILE), "utf8");
    const violations = findViolations(source);

    expect(
      violations.map((violation) => `${PROJECTION_FILE}:${violation.line} ${violation.form}`)
    ).toEqual([]);
  });

  it("guards a file that actually exists and still contains upsertOrder", () => {
    // A renamed/moved target would make the whole check vacuously pass.
    const source = readFileSync(path.join(repoRoot, PROJECTION_FILE), "utf8");
    expect(source).toContain("const upsertOrder");
    expect(source).toContain("deleteMany");
  });
});
