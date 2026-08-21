import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { normalizeImportedRows } from "@/lib/phase1/normalization";
import { assignContactToSdr } from "@/lib/phase1/sdr";
import { readState, writeState } from "@/lib/phase1/store";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { excelSerialToIsoDate, readXlsxRows } from "@/lib/phase1/xlsx";
import type { AppState, CsvImportMapping, LeadJob, ProcessingStatus, RawLead } from "@/lib/phase1/types";

/**
 * Imports a flat lead spreadsheet, attaches its non-core columns as account
 * custom fields, and assigns every new contact to one SDR.
 *
 * Runs the rows through `normalizeImportedRows` — the same path the CSV importer
 * uses — so companies/contacts get the pipeline's own dedupe, grade, score and
 * priority rather than hand-made values, and NO verification/enrichment provider
 * calls fire.
 *
 * Writes through the snapshot (`readState`/`writeState`). Companies, contacts,
 * customFields and customFieldValues are all blob-projected, so this must not go
 * near the tables directly. `writeState` also avoids `updateState`'s 30s
 * transaction cap, which a few hundred rows plus a full projection will exceed.
 *
 * DRY RUN by default.
 *
 *   IMPORT_FILE=<path>        .xlsx to read (required)
 *   IMPORT_WORKSPACE_ID=<id>  default workspace-acme-outbound (the live team)
 *   IMPORT_SDR_ID=<id>        SDR to assign every new contact to (required)
 *   IMPORT_ACTOR_ID=<id>      workspace member recorded as the importer
 *   IMPORT_SOURCE=<label>     lead-job / source label
 *   IMPORT_APPLY=1            actually write
 */

/** Columns that become the contact/account record itself. */
const MAPPING: CsvImportMapping = {
  companyName: "Company Name",
  contactName: "Contact Name",
  email: "Contact Email",
  phone: "Contact Phone"
};

/**
 * Everything else in the sheet, rendered on the contact + account dossier as
 * "Key account fields". Order here is the order shown.
 */
const ACCOUNT_FIELDS: Array<{ label: string; from: (row: Record<string, string>) => string }> = [
  { label: "DBA", from: (r) => r["DBA"] },
  { label: "Business Category", from: (r) => r["Business Category"] },
  { label: "NIGP Codes", from: (r) => r["NIGP code and description"] },
  { label: "License Start Date", from: (r) => excelSerialToIsoDate(r["License Start Date"]) },
  { label: "Ethnicity", from: (r) => r["Ethnicity"] },
  {
    label: "Mailing Address",
    from: (r) =>
      [r["Mailing Address"], r["Mailing City"], [r["Mailing State"], r["Mailing Zip"]].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
  },
  { label: "Website Verification", from: (r) => r["Website Verification"] },
  { label: "Verification Basis", from: (r) => r["Verification Basis"] },
  { label: "Verification Source", from: (r) => r["Verification Source"] },
  { label: "Comments", from: (r) => r["Comments"] }
];

async function main() {
  if (resolveStorageDriver() !== "prisma") {
    throw new Error("import-xlsx-leads requires SYNCORE_STORAGE_DRIVER=prisma and a DATABASE_URL.");
  }
  const file = required("IMPORT_FILE");
  const sdrId = required("IMPORT_SDR_ID");
  const workspaceId = process.env.IMPORT_WORKSPACE_ID ?? "workspace-acme-outbound";
  const actorUserId = process.env.IMPORT_ACTOR_ID ?? sdrId;
  const source = process.env.IMPORT_SOURCE ?? "Spreadsheet import";
  const apply = process.env.IMPORT_APPLY === "1";

  const rows = readXlsxRows(readFileSync(file));
  console.log(`file: ${file}`);
  console.log(`rows: ${rows.length}`);
  console.log(`columns: ${Object.keys(rows[0] ?? {}).join(" | ")}`);
  if (rows.length === 0) throw new Error("Sheet has no data rows.");

  const missingCore = rows.filter((row) => !row[MAPPING.companyName!] || !row[MAPPING.email!]).length;
  console.log(`rows missing company or email: ${missingCore}`);

  const state = await readState();
  const before = state.contacts.filter((contact) => contact.workspaceId === workspaceId).length;
  const nowIso = new Date().toISOString();

  const leadJob: LeadJob = {
    id: `job-${randomUUID()}`,
    workspaceId,
    name: source,
    status: "Queued",
    progress: 0,
    sources: [source],
    raw: 0,
    normalized: 0,
    duplicates: 0,
    suppressed: 0,
    verified: 0,
    enriched: 0,
    exported: 0,
    pushedToCrm: 0,
    actualCost: 0,
    actualCostCents: 0,
    actualCostSource: "Actual",
    eta: "Direct import",
    errorSummary: "None",
    createdById: actorUserId,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.leadJobs.unshift(leadJob);

  const rawLeads: RawLead[] = rows.map((row, index) => ({
    id: `raw-${randomUUID()}`,
    workspaceId,
    leadJobId: leadJob.id,
    source,
    sourceRecordId: `${source}-${index + 1}`,
    sourcePayload: row,
    extractedAt: nowIso,
    processingStatus: "Pending" as ProcessingStatus
  }));
  state.rawLeads.unshift(...rawLeads);

  const beforeIds = new Set(
    state.contacts.filter((contact) => contact.workspaceId === workspaceId).map((contact) => contact.id)
  );
  const counts = normalizeImportedRows({ state, workspaceId, leadJob, rawLeads, mapping: MAPPING });
  const newContacts = state.contacts.filter(
    (contact) => contact.workspaceId === workspaceId && !beforeIds.has(contact.id)
  );
  console.log(`normalize counts: ${JSON.stringify(counts)}`);
  console.log(`contacts ${before} -> ${state.contacts.filter((c) => c.workspaceId === workspaceId).length} (new ${newContacts.length})`);

  const fieldStats = attachAccountFields(state, workspaceId, rows, nowIso);
  console.log(`custom fields: ${JSON.stringify(fieldStats)}`);

  let assigned = 0;
  const assignErrors: string[] = [];
  for (const contact of newContacts) {
    try {
      assignContactToSdr(state, {
        workspaceId,
        contactId: contact.id,
        sdrId,
        actorUserId,
        reason: source,
        method: "Round robin"
      });
      assigned += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (assignErrors.length < 5) assignErrors.push(`${contact.id}: ${message}`);
    }
  }
  console.log(`assigned to ${sdrId}: ${assigned}${assignErrors.length ? ` | errors: ${JSON.stringify(assignErrors)}` : ""}`);

  const sample = newContacts.slice(0, 3).map((contact) => ({
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    grade: contact.grade,
    score: contact.score,
    priority: contact.priority,
    owner: contact.owner
  }));
  console.log(`sample: ${JSON.stringify(sample)}`);
  const grades: Record<string, number> = {};
  for (const contact of newContacts) grades[contact.grade] = (grades[contact.grade] ?? 0) + 1;
  console.log(`grade split: ${JSON.stringify(grades)}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with IMPORT_APPLY=1 to apply.");
    return;
  }

  await writeState(state);
  console.log("\nApplied.");
}

/**
 * Creates the workspace's custom-field definitions once, then writes one value
 * per account. Existing definitions with the same name are reused so a re-run
 * updates values instead of duplicating the field set.
 */
function attachAccountFields(
  state: AppState,
  workspaceId: string,
  rows: Array<Record<string, string>>,
  nowIso: string
) {
  const byCompanyName = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const key = (row[MAPPING.companyName!] ?? "").trim().toLowerCase();
    if (key && !byCompanyName.has(key)) byCompanyName.set(key, row);
  }

  const fieldIdByLabel = new Map<string, string>();
  for (const { label } of ACCOUNT_FIELDS) {
    const existing = state.customFields.find(
      (field) => field.workspaceId === workspaceId && field.objectType === "company" && field.name === label
    );
    if (existing) {
      fieldIdByLabel.set(label, existing.id);
      continue;
    }
    const id = `field-${randomUUID()}`;
    state.customFields.push({
      id,
      workspaceId,
      objectType: "company",
      name: label,
      fieldType: label === "License Start Date" ? "date" : "text",
      options: [],
      createdAt: nowIso
    });
    fieldIdByLabel.set(label, id);
  }

  let valuesWritten = 0;
  let accountsMatched = 0;
  for (const company of state.companies.filter((item) => item.workspaceId === workspaceId)) {
    const row = byCompanyName.get(company.name.trim().toLowerCase());
    if (!row) continue;
    accountsMatched += 1;
    for (const { label, from } of ACCOUNT_FIELDS) {
      const value = (from(row) ?? "").trim();
      if (!value) continue;
      const customFieldId = fieldIdByLabel.get(label)!;
      const existing = state.customFieldValues.find(
        (item) => item.customFieldId === customFieldId && item.objectId === company.id
      );
      if (existing) {
        existing.value = value;
        existing.updatedAt = nowIso;
      } else {
        state.customFieldValues.push({
          id: `cfv-${randomUUID()}`,
          workspaceId,
          customFieldId,
          objectId: company.id,
          value,
          updatedAt: nowIso
        });
      }
      valuesWritten += 1;
    }
  }

  return { definitions: fieldIdByLabel.size, accountsMatched, valuesWritten };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
