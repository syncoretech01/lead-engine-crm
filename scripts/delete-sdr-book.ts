import { readState, writeState } from "@/lib/phase1/store";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { AppState } from "@/lib/phase1/types";

/**
 * Deletes an SDR's whole book — the contacts assigned to them, the accounts
 * behind those contacts, and everything hanging off both.
 *
 * Distinct from `reset-sdr-leads.ts`, which KEEPS the contacts and only clears
 * their engagement to restart the SLA clock. This one removes the records.
 *
 * The account side is the part worth understanding: `Account` and `CrmContact`
 * rows are not stored, they are DERIVED by the projection from `state.companies`
 * and `state.contacts` under the same ids (persistence-projection.ts). So
 * dropping the blob entries clears the CRM layer too, and there is nothing extra
 * to delete — but it also means a company must never be dropped while another
 * rep still has a contact on it, or that rep's account vanishes from under them.
 * That is a hard guard below, not a warning.
 *
 * Everything here is blob-projected, so this writes through the snapshot
 * (`readState`/`writeState`) and never touches the tables. `writeState` also
 * avoids `updateState`'s 30s cap.
 *
 * IRREVERSIBLE. Take an RDS snapshot first.
 *
 * DRY RUN by default.
 *
 *   DELETE_SDR_ID=<id>         whose book to delete (required)
 *   DELETE_WORKSPACE_ID=<id>   default workspace-acme-outbound (the live team)
 *   DELETE_EXPECT_NAME=<name>  refuse unless the SDR's name matches
 *   DELETE_EXPECT_COUNT=<n>    refuse unless exactly n contacts would go
 *   DELETE_APPLY=1             actually write
 */

async function main() {
  if (resolveStorageDriver() !== "prisma") {
    throw new Error("delete-sdr-book requires SYNCORE_STORAGE_DRIVER=prisma and a DATABASE_URL.");
  }
  const sdrId = required("DELETE_SDR_ID");
  const workspaceId = process.env.DELETE_WORKSPACE_ID ?? "workspace-acme-outbound";
  const expectName = process.env.DELETE_EXPECT_NAME;
  const expectCount = process.env.DELETE_EXPECT_COUNT ? Number(process.env.DELETE_EXPECT_COUNT) : undefined;
  const apply = process.env.DELETE_APPLY === "1";

  const state = await readState();
  const sdr = state.users.find((user) => user.id === sdrId);
  if (!sdr) throw new Error(`No user ${sdrId}.`);
  console.log(`SDR: ${sdr.name} <${sdr.email}>`);
  // The id is a UUID nobody eyeballs; make the caller say who they mean.
  if (expectName && sdr.name !== expectName) {
    throw new Error(`Expected the SDR to be "${expectName}", found "${sdr.name}". Refusing.`);
  }

  const assignments = state.sdrAssignments.filter(
    (item) => item.workspaceId === workspaceId && item.assignedSdrId === sdrId
  );
  const contactIds = new Set(assignments.map((item) => item.contactId));
  console.log(`assignments: ${assignments.length} | unique contacts: ${contactIds.size}`);
  if (expectCount !== undefined && contactIds.size !== expectCount) {
    throw new Error(`Expected ${expectCount} contacts, found ${contactIds.size}. Refusing.`);
  }
  if (contactIds.size === 0) throw new Error("That SDR has no assigned contacts — nothing to do.");

  // Companies are only removed when nothing outside the delete set remains on
  // them. A shared account belongs to whoever else is still on it.
  const candidateCompanyIds = new Set(
    state.contacts.filter((contact) => contactIds.has(contact.id)).map((contact) => contact.companyId)
  );
  candidateCompanyIds.delete(undefined as unknown as string);
  const companyIds = new Set<string>();
  const sharedCompanies: string[] = [];
  for (const companyId of candidateCompanyIds) {
    if (!companyId) continue;
    const survivors = state.contacts.filter(
      (contact) => contact.companyId === companyId && !contactIds.has(contact.id)
    );
    if (survivors.length === 0) {
      companyIds.add(companyId);
    } else {
      const company = state.companies.find((item) => item.id === companyId);
      sharedCompanies.push(`${company?.name ?? companyId} (kept — ${survivors.length} contact(s) owned by ${[...new Set(survivors.map((s) => s.owner))].join(", ")})`);
    }
  }
  console.log(`accounts to delete: ${companyIds.size} of ${candidateCompanyIds.size}`);
  for (const line of sharedCompanies.slice(0, 10)) console.log(`  SHARED, keeping: ${line}`);

  const touchesContact = (row: { contactId?: string }) => Boolean(row.contactId && contactIds.has(row.contactId));
  const touchesCompany = (row: { companyId?: string }) => Boolean(row.companyId && companyIds.has(row.companyId));
  const touchesEither = (row: { contactId?: string; companyId?: string }) => touchesContact(row) || touchesCompany(row);

  const before = counts(state);

  state.contacts = state.contacts.filter((row) => !contactIds.has(row.id));
  state.companies = state.companies.filter((row) => !companyIds.has(row.id));
  state.sdrAssignments = state.sdrAssignments.filter((row) => !touchesEither(row));
  state.followUpReminders = state.followUpReminders.filter((row) => !touchesEither(row));
  state.activities = state.activities.filter((row) => !touchesEither(row));
  state.tasks = state.tasks.filter((row) => !touchesEither(row));
  state.notes = state.notes.filter((row) => !touchesEither(row));
  state.opportunities = state.opportunities.filter((row) => !touchesEither(row));
  state.trackedCalls = state.trackedCalls.filter((row) => !touchesEither(row));
  state.callLogs = state.callLogs.filter((row) => !touchesEither(row));
  state.emailEvents = state.emailEvents.filter((row) => !touchesEither(row));
  state.smsEvents = state.smsEvents.filter((row) => !touchesEither(row));
  state.verificationResults = state.verificationResults.filter((row) => !touchesContact(row));
  // Custom field values key off a plain objectId string with no foreign key, so
  // nothing else would ever clean these up.
  const deletedObjectIds = new Set<string>([...contactIds, ...companyIds]);
  state.customFieldValues = state.customFieldValues.filter((row) => !deletedObjectIds.has(row.objectId));

  const after = counts(state);
  for (const key of Object.keys(before) as Array<keyof ReturnType<typeof counts>>) {
    const delta = before[key] - after[key];
    if (delta) console.log(`  ${key}: ${before[key]} -> ${after[key]} (-${delta})`);
  }

  if (!apply) {
    console.log("\nDRY RUN - nothing written. Re-run with DELETE_APPLY=1 to apply.");
    return;
  }

  await writeState(state);
  console.log("\nApplied.");
}

function counts(state: AppState) {
  return {
    contacts: state.contacts.length,
    companies: state.companies.length,
    sdrAssignments: state.sdrAssignments.length,
    followUpReminders: state.followUpReminders.length,
    activities: state.activities.length,
    tasks: state.tasks.length,
    notes: state.notes.length,
    opportunities: state.opportunities.length,
    trackedCalls: state.trackedCalls.length,
    callLogs: state.callLogs.length,
    emailEvents: state.emailEvents.length,
    smsEvents: state.smsEvents.length,
    verificationResults: state.verificationResults.length,
    customFieldValues: state.customFieldValues.length
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
