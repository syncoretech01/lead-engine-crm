import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
  NICHE_BRIEF_STATUSES,
  NICHE_REQUEST_SOURCE_CHANNELS,
  NICHE_REQUEST_STATUSES,
  RESEARCH_RUN_STATUSES,
  STAGE_TYPES
} from "@syncore/contracts";
import { createSeedState } from "@/lib/phase1/seed";

/**
 * CRM-1 schema invariants — golden rule 1, enforced from the other side.
 *
 * `npm run check:projection-invariant` guards `persistence-projection.ts` by name.
 * These tests guard the two things that check cannot see:
 *
 *   · the blob itself (`AppState`) — a Growth OS array must never appear there
 *   · the write-table lists that feed `updateState`
 *
 * A Growth OS model reachable from any of them is written through the blob, and
 * the `deleteMany` at persistence-projection.ts:1599 empties it on the next sync.
 *
 * Plus enum parity: every Growth OS Prisma enum must equal its
 * `@syncore/contracts` counterpart member-for-member. Mirroring contracts
 * verbatim is what lets this repo have no mapping layer — and a mapping layer
 * that does not exist cannot drift. If contracts changes a member, this fails
 * here rather than at an HTTP boundary in production.
 */

const repoRoot = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

/** The seven tables CRM-1 adds. All Prisma-native, none blob-projected. */
const GROWTH_TABLES = [
  "nicheRequest",
  "researchRun",
  "nicheBrief",
  "campaign",
  "campaignStageRun",
  "approval",
  "costEntry",
  "notifyOutbox"
] as const;

const plural = (name: string) => (name.endsWith("y") ? `${name.slice(0, -1)}ies` : `${name}s`);

describe("growth models are absent from the blob", () => {
  it("no Growth OS array exists on AppState", () => {
    // The blob's shape is its top-level keys. If a Growth OS collection is here,
    // it is blob-projected by definition and rule 1 is already broken.
    const stateKeys = Object.keys(createSeedState());
    const leaked = GROWTH_TABLES.flatMap((table) =>
      [table, plural(table)].filter((form) => stateKeys.includes(form))
    );
    expect(leaked).toEqual([]);
  });

  it("no Growth OS table appears in the normalized write-table lists", () => {
    // These lists drive scoped `updateState` writes. Membership here means the
    // table is written through the blob.
    const source = read("lib/phase1/normalized-write-tables.ts");
    const leaked = GROWTH_TABLES.flatMap((table) =>
      [table, plural(table)].filter((form) =>
        new RegExp(`["']${form}["']`).test(source)
      )
    );
    expect(leaked).toEqual([]);
  });

  it("no Growth OS table appears in upsertOrder or the projection file", () => {
    // Belt and braces with check:projection-invariant — that script guards the
    // build, this guards the suite, and neither depends on the other running.
    const source = read("lib/phase1/persistence-projection.ts");
    const leaked = GROWTH_TABLES.flatMap((table) =>
      [table, plural(table)].filter((form) =>
        new RegExp(`["']${form}["']`).test(source)
      )
    );
    expect(leaked).toEqual([]);
  });

  it("upsertOrder still has exactly the 70 legacy entries", () => {
    // A count, so adding a Growth OS entry fails here even if it were somehow
    // spelled in a way the name checks above missed.
    const source = read("lib/phase1/persistence-projection.ts");
    const block = source.slice(
      source.indexOf("const upsertOrder"),
      source.indexOf("type PrismaMirrorClient")
    );
    expect(block.match(/\{ table: "/g)?.length).toBe(70);
  });
});

describe("growth enums mirror @syncore/contracts verbatim", () => {
  // Read the enum bodies out of the schema rather than importing the generated
  // client: this asserts what is actually declared, and it works before
  // `prisma generate` has run.
  const schema = read("prisma/schema.prisma");

  const enumMembers = (name: string): string[] => {
    const match = schema.match(new RegExp(`\\nenum ${name} \\{([^}]*)\\}`));
    if (!match) throw new Error(`enum ${name} not found in schema.prisma`);
    return match[1]
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("///"));
  };

  it.each([
    ["NicheRequestSourceChannel", NICHE_REQUEST_SOURCE_CHANNELS],
    ["NicheRequestStatus", NICHE_REQUEST_STATUSES],
    ["ResearchRunStatus", RESEARCH_RUN_STATUSES],
    ["NicheBriefStatus", NICHE_BRIEF_STATUSES],
    ["ApprovalType", APPROVAL_TYPES],
    ["ApprovalStatus", APPROVAL_STATUSES],
    ["StageType", STAGE_TYPES]
  ])("%s matches contracts member-for-member and in order", (name, contractsMembers) => {
    expect(enumMembers(name)).toEqual([...contractsMembers]);
  });

  it("StageType has all 18 pipeline stages", () => {
    expect(enumMembers("StageType")).toHaveLength(18);
  });

  it("ApprovalStatus has no fifth member", () => {
    // Two-person approval is carried by firstApprovedBy/firstApprovedAt, not by
    // an extra status. Contracts fixes this enum at four and its own tests fail
    // if a fifth appears; adding one here would diverge silently.
    expect(enumMembers("ApprovalStatus")).toHaveLength(4);
    expect(enumMembers("ApprovalStatus")).not.toContain("awaiting_second_approver");
  });
});

describe("no-brief-before-research is structural", () => {
  it("NicheBrief.researchRunId is required, not optional", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(
      schema.indexOf("model NicheBrief {"),
      schema.indexOf("model Campaign {")
    );
    // `String?` would make a brief with no run behind it representable, which is
    // exactly what v9.1 §7 and §26.3 forbid.
    expect(model).toMatch(/^\s*researchRunId\s+String\s*$/m);
    expect(model).not.toMatch(/^\s*researchRunId\s+String\?/m);
  });
});
