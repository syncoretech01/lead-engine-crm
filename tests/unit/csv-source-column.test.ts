import { describe, expect, it } from "vitest";
import { normalizeImportedRows } from "@/lib/phase1/normalization";
import { createSeedState } from "@/lib/phase1/seed";
import type { AppState, CsvImportMapping, RawLead } from "@/lib/phase1/types";

function rawLead(workspaceId: string, leadJobId: string, payload: Record<string, string>, fallbackSource: string): RawLead {
  return {
    id: `raw-${Math.random().toString(36).slice(2)}`,
    workspaceId,
    leadJobId,
    source: fallbackSource,
    sourceRecordId: `rec-${Math.random().toString(36).slice(2)}`,
    sourcePayload: payload,
    sourceConfidence: 70,
    extractedAt: new Date().toISOString(),
    processingStatus: "Pending"
  };
}

function run(state: AppState, rawLeads: RawLead[], mapping: CsvImportMapping) {
  const workspaceId = state.workspaces[0].id;
  const job = state.leadJobs[0];
  state.rawLeads.unshift(...rawLeads);
  normalizeImportedRows({ state, workspaceId, leadJob: job, rawLeads, mapping });
  return { workspaceId, job };
}

describe("CSV import per-row lead source", () => {
  it("uses the mapped source column per row, falling back to the label when empty", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const job = state.leadJobs[0];
    const withSource = rawLead(
      workspaceId,
      job.id,
      { company: "Northstar Tools", contact: "Jane Doe", email: "jane@northstartools-uniq.com", lead_source: "LinkedIn" },
      "CSV Upload"
    );
    const withoutSource = rawLead(
      workspaceId,
      job.id,
      { company: "Beacon Labs", contact: "John Roe", email: "john@beaconlabs-uniq.com" },
      "CSV Upload"
    );

    run(state, [withSource, withoutSource], { source: "lead_source" });

    // Mapped row carries its own source everywhere downstream.
    expect(withSource.source).toBe("LinkedIn");
    const mappedContact = state.contacts.find((c) => c.email === "jane@northstartools-uniq.com");
    expect(mappedContact?.sourceLineage).toContain("LinkedIn");
    expect(state.normalizedRecords.find((n) => n.email === "jane@northstartools-uniq.com")?.source).toBe("LinkedIn");

    // Row with no source value falls back to the import-wide label.
    expect(withoutSource.source).toBe("CSV Upload");
    expect(state.normalizedRecords.find((n) => n.email === "john@beaconlabs-uniq.com")?.source).toBe("CSV Upload");
  });

  it("auto-detects a 'source' header when no column is mapped", () => {
    const state = createSeedState();
    const lead = rawLead(
      state.workspaces[0].id,
      state.leadJobs[0].id,
      { company: "Cobalt Group", contact: "Sam Ray", email: "sam@cobaltgroup-uniq.com", source: "Webinar" },
      "CSV Upload"
    );

    run(state, [lead], {});

    expect(lead.source).toBe("Webinar");
    expect(state.normalizedRecords.find((n) => n.email === "sam@cobaltgroup-uniq.com")?.source).toBe("Webinar");
  });
});
