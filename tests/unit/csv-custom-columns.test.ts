import { describe, expect, it } from "vitest";
import { normalizeImportedRows } from "@/lib/phase1/normalization";
import { createSeedState } from "@/lib/phase1/seed";
import type { CsvImportMapping, RawLead } from "@/lib/phase1/types";

function rawLead(workspaceId: string, leadJobId: string, payload: Record<string, string>): RawLead {
  return {
    id: `raw-${Math.random().toString(36).slice(2)}`,
    workspaceId,
    leadJobId,
    source: "CSV Upload",
    sourceRecordId: `rec-${Math.random().toString(36).slice(2)}`,
    sourcePayload: payload,
    sourceConfidence: 70,
    extractedAt: new Date().toISOString(),
    processingStatus: "Pending"
  };
}

describe("CSV import custom columns", () => {
  it("maps custom columns to contact custom fields and reuses the field across rows", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const job = state.leadJobs[0];
    const fieldsBefore = state.customFields.length;

    const leads = [
      rawLead(workspaceId, job.id, {
        company: "Vertex Systems",
        contact: "Dana Fox",
        email: "dana@vertexsystems-uniq.com",
        linkedin_url: "https://linkedin.com/in/danafox",
        region: "West"
      }),
      rawLead(workspaceId, job.id, {
        company: "Halo Robotics",
        contact: "Eli Stone",
        email: "eli@halorobotics-uniq.com",
        linkedin_url: "https://linkedin.com/in/elistone"
        // no region on this row
      })
    ];
    state.rawLeads.unshift(...leads);

    const mapping: CsvImportMapping = {
      customColumns: [
        { column: "linkedin_url", fieldName: "LinkedIn URL" },
        { column: "region", fieldName: "Region" }
      ]
    };
    normalizeImportedRows({ state, workspaceId, leadJob: job, rawLeads: leads, mapping });

    // Two new contact custom fields created (LinkedIn URL, Region) — once, not per row.
    const linkedinField = state.customFields.find(
      (f) => f.objectType === "contact" && f.name === "LinkedIn URL" && f.workspaceId === workspaceId
    );
    const regionField = state.customFields.find(
      (f) => f.objectType === "contact" && f.name === "Region" && f.workspaceId === workspaceId
    );
    expect(linkedinField).toBeDefined();
    expect(regionField).toBeDefined();
    expect(state.customFields.length).toBe(fieldsBefore + 2);

    // Values land on the right contacts.
    const dana = state.contacts.find((c) => c.email === "dana@vertexsystems-uniq.com");
    const eli = state.contacts.find((c) => c.email === "eli@halorobotics-uniq.com");
    const valueFor = (fieldId: string, contactId: string) =>
      state.customFieldValues.find((v) => v.customFieldId === fieldId && v.objectId === contactId)?.value;

    expect(valueFor(linkedinField!.id, dana!.id)).toBe("https://linkedin.com/in/danafox");
    expect(valueFor(regionField!.id, dana!.id)).toBe("West");
    expect(valueFor(linkedinField!.id, eli!.id)).toBe("https://linkedin.com/in/elistone");
    // Eli's row had no region value → no Region value written for Eli.
    expect(valueFor(regionField!.id, eli!.id)).toBeUndefined();
  });
});
