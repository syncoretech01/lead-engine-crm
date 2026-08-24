import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { parseCsv } from "@/lib/phase1/csv";
import { attachImportAccountFields, type ImportAccountField } from "@/lib/phase1/import-account-fields";
import { normalizeImportedRows } from "@/lib/phase1/normalization";
import { assignContactToSdr } from "@/lib/phase1/sdr";
import { readState, writeState } from "@/lib/phase1/store";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { AppState, Contact, CsvImportMapping, LeadJob, ProcessingStatus, RawLead } from "@/lib/phase1/types";

/**
 * Imports a flat CSV of local-business leads (a Maps-style export: company,
 * phone, address, category, rating), attaches its non-core columns as account
 * custom fields, and assigns every new contact to one SDR.
 *
 * The .xlsx sibling (`import-xlsx-leads.ts`) covers spreadsheet sources; this one
 * exists because these exports arrive as CSV with a different column set. Both
 * run rows through `normalizeImportedRows` - the same path the in-app CSV
 * importer uses - so dedupe, grade, score and priority come from the pipeline and
 * NO verification/enrichment provider calls fire.
 *
 * Writes through the snapshot (`readState`/`writeState`). Companies, contacts,
 * customFields and customFieldValues are all blob-projected, so this must not go
 * near the tables directly. `writeState` also avoids `updateState`'s 30s
 * transaction cap, which a few hundred rows plus a full projection will exceed.
 *
 * DRY RUN by default.
 *
 *   IMPORT_FILE=<path>          .csv to read (required)
 *   IMPORT_SDR_ID=<id>          SDR to assign every new contact to (required)
 *   IMPORT_WORKSPACE_ID=<id>    default workspace-acme-outbound (the live team)
 *   IMPORT_ACTOR_ID=<id>        workspace member recorded as the importer
 *   IMPORT_SOURCE=<label>       lead-job / source label
 *   IMPORT_CATEGORY_MATCH=<re>  keep only rows whose Category matches this regex
 *   IMPORT_APPLY=1              actually write
 */

/**
 * Columns that become the record itself.
 *
 * `contactName` is deliberately the company name. The sheet carries no person -
 * these are shop phone numbers - and without it every contact normalizes to
 * "Unknown contact", which is useless in a call queue. Naming the contact after
 * the shop is what an SDR asks for when the phone is answered.
 */
const MAPPING: CsvImportMapping = {
  companyName: "Company Name",
  contactName: "Company Name",
  phone: "Phone",
  website: "Website",
  city: "city",
  state: "state",
  country: "Country",
  industry: "Category"
};

/** Everything else, rendered on the contact + account dossier as "Key account fields". */
const ACCOUNT_FIELDS: ImportAccountField[] = [
  { label: "Category", from: (r) => r["Category"] },
  { label: "Street", from: (r) => r["street"] },
  {
    label: "City/State",
    from: (r) => [r["city"], r["state"]].map((part) => (part ?? "").trim()).filter(Boolean).join(", ")
  },
  { label: "Review Score", from: (r) => r["Review Score"] },
  { label: "Review Count", from: (r) => r["Review Count"] },
  { label: "Website", from: (r) => r["Website"] }
];

async function main() {
  if (resolveStorageDriver() !== "prisma") {
    throw new Error("import-csv-leads requires SYNCORE_STORAGE_DRIVER=prisma and a DATABASE_URL.");
  }
  const file = required("IMPORT_FILE");
  const sdrId = required("IMPORT_SDR_ID");
  const workspaceId = process.env.IMPORT_WORKSPACE_ID ?? "workspace-acme-outbound";
  const actorUserId = process.env.IMPORT_ACTOR_ID ?? sdrId;
  const source = process.env.IMPORT_SOURCE ?? "CSV import";
  const categoryMatch = process.env.IMPORT_CATEGORY_MATCH;
  const apply = process.env.IMPORT_APPLY === "1";

  const allRows = parseCsv(readFileSync(file, "utf8"));
  console.log(`file: ${file}`);
  console.log(`rows: ${allRows.length}`);
  console.log(`columns: ${Object.keys(allRows[0] ?? {}).join(" | ")}`);
  if (allRows.length === 0) throw new Error("File has no data rows.");

  const rows = categoryMatch
    ? allRows.filter((row) => new RegExp(categoryMatch, "i").test(row[MAPPING.industry!] ?? ""))
    : allRows;
  if (categoryMatch) {
    console.log(`category filter /${categoryMatch}/i: kept ${rows.length}, dropped ${allRows.length - rows.length}`);
  }
  if (rows.length === 0) throw new Error("The category filter kept no rows.");

  const missingCompany = rows.filter((row) => !(row[MAPPING.companyName!] ?? "").trim()).length;
  const missingPhone = rows.filter((row) => !(row[MAPPING.phone!] ?? "").trim()).length;
  console.log(`rows missing company: ${missingCompany} | missing phone: ${missingPhone}`);

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
  console.log(
    `contacts ${before} -> ${state.contacts.filter((c) => c.workspaceId === workspaceId).length} (new ${newContacts.length})`
  );

  const fieldStats = attachImportAccountFields(state, workspaceId, rows, ACCOUNT_FIELDS, MAPPING.companyName!, nowIso);
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

  console.log(`callable (has phone, not suppressed): ${newContacts.filter((c) => c.phone && !c.isSuppressed).length}`);
  const sample = newContacts.slice(0, 3).map((contact) => ({
    name: contact.name,
    phone: contact.phone,
    grade: contact.grade,
    score: contact.score,
    priority: contact.priority,
    status: contact.status
  }));
  console.log(`sample: ${JSON.stringify(sample)}`);
  const grades: Record<string, number> = {};
  for (const contact of newContacts) grades[contact.grade] = (grades[contact.grade] ?? 0) + 1;
  console.log(`grade split: ${JSON.stringify(grades)}`);
  logSampleAccountFields(state, workspaceId, newContacts.slice(0, 2));

  if (!apply) {
    console.log("\nDRY RUN - nothing written. Re-run with IMPORT_APPLY=1 to apply.");
    return;
  }

  await writeState(state);
  console.log("\nApplied.");
}

/** Prints what the dossier's "Key account fields" card will show, for a couple of rows. */
function logSampleAccountFields(state: AppState, workspaceId: string, contacts: Contact[]) {
  const fieldNames = new Map(
    state.customFields
      .filter((field) => field.workspaceId === workspaceId && field.objectType === "company")
      .map((field) => [field.id, field.name])
  );
  for (const contact of contacts) {
    const shown = state.customFieldValues
      .filter((value) => value.objectId === contact.companyId && value.value)
      .map((value) => `${fieldNames.get(value.customFieldId) ?? "?"}=${value.value}`);
    console.log(`key account fields for ${contact.name}: ${shown.join(" | ") || "(none)"}`);
  }
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
