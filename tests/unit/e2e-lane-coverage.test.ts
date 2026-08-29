import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import playwrightConfig from "@/playwright.config";

/**
 * The two e2e lanes must PARTITION tests/e2e: every spec belongs to exactly one.
 *
 * The lanes replaced a `--grep "Growth OS"` split whose weakness was that a spec
 * titled anything else silently became advisory. A directory split has its own
 * version of that weakness if the ignore rule and the legacy testDir disagree:
 * a spec under a nested `campaigns/legacy/` (excluded from blocking, outside the
 * legacy project's testDir) — or under `Legacy/` with a capital L, since
 * Playwright's string matchers are case-insensitive — would be collected by
 * NEITHER project, and the run would still report success.
 *
 * This asserts the partition directly against the shipped config, so the hole
 * cannot reopen silently.
 */
const E2E_ROOT = path.resolve(__dirname, "../e2e");
const LEGACY_DIR = path.join(E2E_ROOT, "legacy");

function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(full);
    return entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

type Project = { name?: string; testDir?: string; testIgnore?: unknown };
const projects = (playwrightConfig.projects ?? []) as Project[];
const blocking = projects.find((project) => project.name === "blocking");
const legacy = projects.find((project) => project.name === "legacy");

/** Mirrors Playwright's own selection: inside testDir, and not matched by testIgnore. */
function collects(project: Project | undefined, file: string): boolean {
  if (!project?.testDir) return false;
  const root = path.resolve(__dirname, "..", "..", project.testDir);
  if (!file.startsWith(root + path.sep)) return false;
  const ignore = project.testIgnore;
  if (ignore === undefined) return true;
  if (ignore instanceof RegExp) return !ignore.test(file);
  // Deliberately not modelled. Playwright prefixes `**/` to a string pattern and
  // matches it case-insensitively, so a string here silently excludes nested and
  // differently-cased `legacy` directories from the blocking lane without the
  // legacy lane picking them up. Fail loudly rather than approximate minimatch.
  throw new Error(
    `testIgnore on project "${project.name}" must be an anchored RegExp, not ${JSON.stringify(ignore)} — ` +
      "a string pattern is unanchored and case-insensitive, which lets a spec fall between the two lanes."
  );
}

describe("e2e lane coverage", () => {
  it("defines exactly the two lanes CI runs", () => {
    expect(projects.map((project) => project.name).sort()).toEqual(["blocking", "legacy"]);
  });

  it("assigns every spec under tests/e2e to exactly one lane", () => {
    const files = specFiles(E2E_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const orphaned: string[] = [];
    const doubled: string[] = [];
    for (const file of files) {
      const lanes = [collects(blocking, file), collects(legacy, file)].filter(Boolean).length;
      if (lanes === 0) orphaned.push(path.relative(E2E_ROOT, file));
      if (lanes > 1) doubled.push(path.relative(E2E_ROOT, file));
    }

    expect(orphaned, "specs collected by NEITHER lane — they can never fail the build").toEqual([]);
    expect(doubled, "specs collected by BOTH lanes — they would run twice").toEqual([]);
  });

  it("puts a nested legacy directory in a lane rather than nowhere", () => {
    // The concrete hole a broad `**/legacy/**` string pattern opens.
    const nested = path.join(E2E_ROOT, "campaigns", "legacy", "nested.spec.ts");
    const lanes = [collects(blocking, nested), collects(legacy, nested)].filter(Boolean).length;
    expect(lanes, "a nested legacy/ directory must still be collected by the blocking lane").toBe(1);
  });

  it("keeps the real legacy directory advisory-only", () => {
    const legacySpec = path.join(LEGACY_DIR, "app-smoke.spec.ts");
    expect(collects(legacy, legacySpec)).toBe(true);
    expect(collects(blocking, legacySpec)).toBe(false);
  });
});
