import { describe, expect, it } from "vitest";

import { detectWorkspaceDuplicates, ignoreDedupeMatch, mergeDedupeMatch } from "@/lib/phase1/dedupe";
import { createSeedState } from "@/lib/phase1/seed";

const DUPLICATE_ID = "contact-duplicate-tenant-test";

function seedWithOpenDuplicateMatch() {
  const state = createSeedState();
  const workspaceId = state.workspaces[0].id;
  const source = state.contacts.find((contact) => !contact.isSuppressed && contact.email);
  if (!source) throw new Error("seed state has no usable contact");

  state.contacts.push({
    ...source,
    id: DUPLICATE_ID,
    score: Math.max(source.score - 10, 1),
    sourceLineage: [...source.sourceLineage, "Tenant isolation duplicate"]
  });

  detectWorkspaceDuplicates(state, workspaceId);
  const match = state.dedupeMatches.find(
    (item) => item.status === "Open" && item.objectType === "contact" && item.duplicateId === DUPLICATE_ID
  );
  if (!match) throw new Error("expected an open dedupe match");

  return { state, workspaceId, match };
}

describe("dedupe cross-tenant isolation (A-DATA-4)", () => {
  it("refuses to merge a match owned by another workspace and leaves state untouched", () => {
    const { state, match } = seedWithOpenDuplicateMatch();
    const before = state.contacts.length;

    expect(mergeDedupeMatch(state, "workspace-someone-else", match.id)).toBe(false);
    expect(state.contacts.length).toBe(before);
    expect(match.status).toBe("Open");
    expect(state.contacts.some((contact) => contact.id === DUPLICATE_ID)).toBe(true);
  });

  it("refuses to ignore a match owned by another workspace", () => {
    const { state, match } = seedWithOpenDuplicateMatch();

    expect(ignoreDedupeMatch(state, "workspace-someone-else", match.id)).toBe(false);
    expect(match.status).toBe("Open");
  });

  it("still allows the owning workspace to merge", () => {
    const { state, workspaceId, match } = seedWithOpenDuplicateMatch();
    const before = state.contacts.length;

    expect(mergeDedupeMatch(state, workspaceId, match.id)).toBe(true);
    expect(state.contacts.length).toBe(before - 1);
    expect(state.contacts.some((contact) => contact.id === DUPLICATE_ID)).toBe(false);
  });
});
