import { readState, writeState } from "@/lib/phase1/store";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

/**
 * Renames a user and/or moves their seat to a different person.
 *
 * There is no in-app path for this: /access can invite, change a role, reset a
 * password, deactivate and remove, but nothing there edits a name or an email.
 *
 * Three things have to move together, which is the reason this is a script and
 * not three hand-written UPDATEs:
 *
 *   1. `User.email` AND `AuthAccount.email` — both are unique columns and the
 *      login goes through the auth account, so changing one leaves the person
 *      unable to sign in under either address.
 *   2. `Contact.owner` is a denormalized NAME string (`userNameForId`, see
 *      lib/phase1/sdr.ts), not a foreign key. Rename the user alone and every
 *      lead they own keeps displaying the old name forever.
 *   3. Optionally the seat's telephony credential and saved daily reports, when
 *      the seat is changing hands rather than the same person changing name.
 *
 * users, authAccounts, contacts and sdrDailyReports are all blob-projected, so
 * this writes through the snapshot (`readState`/`writeState`) and never touches
 * the tables directly. `writeState` also avoids `updateState`'s 30s cap.
 *
 * This does NOT set a password. Do that at /access afterwards — the admin reset
 * takes the password verbatim (so only you ever see it) and revokes every active
 * session for the user, which is exactly what a seat handover needs.
 *
 * DRY RUN by default.
 *
 *   RENAME_USER_ID=<id>              user to change (required)
 *   RENAME_NAME=<name>               new display name (required)
 *   RENAME_EMAIL=<email>             new email (required)
 *   RENAME_EXPECT_EMAIL=<email>      refuse unless the current email matches
 *   RENAME_CLEAR_TELEPHONY=1         wipe phone / caller ID / RingCentral JWT
 *   RENAME_DELETE_DAILY_REPORTS=1    drop the seat's saved end-of-day reports
 *   RENAME_APPLY=1                   actually write
 */

async function main() {
  if (resolveStorageDriver() !== "prisma") {
    throw new Error("rename-user requires SYNCORE_STORAGE_DRIVER=prisma and a DATABASE_URL.");
  }
  const userId = required("RENAME_USER_ID");
  const newName = required("RENAME_NAME");
  const newEmail = required("RENAME_EMAIL").trim().toLowerCase();
  const expectEmail = process.env.RENAME_EXPECT_EMAIL?.trim().toLowerCase();
  const clearTelephony = process.env.RENAME_CLEAR_TELEPHONY === "1";
  const deleteDailyReports = process.env.RENAME_DELETE_DAILY_REPORTS === "1";
  const apply = process.env.RENAME_APPLY === "1";

  const state = await readState();

  const user = state.users.find((item) => item.id === userId);
  if (!user) throw new Error(`No user ${userId}.`);
  const account = state.authAccounts.find((item) => item.userId === userId);
  if (!account) throw new Error(`No auth account for ${userId} — they could not sign in after this.`);

  const oldName = user.name;
  const oldEmail = user.email;
  console.log(`user: ${oldName} <${oldEmail}>`);
  console.log(`auth: <${account.email}> status=${account.status} lastLogin=${account.lastLoginAt ?? "never"}`);

  // Guard against renaming the wrong seat: the id is a UUID nobody eyeballs.
  if (expectEmail && oldEmail.trim().toLowerCase() !== expectEmail) {
    throw new Error(`Expected the current email to be ${expectEmail}, found ${oldEmail}. Refusing.`);
  }
  const emailClash = state.users.find(
    (item) => item.id !== userId && item.email.trim().toLowerCase() === newEmail
  );
  if (emailClash) throw new Error(`${newEmail} already belongs to ${emailClash.name} (${emailClash.id}).`);
  const accountClash = state.authAccounts.find(
    (item) => item.userId !== userId && item.email.trim().toLowerCase() === newEmail
  );
  if (accountClash) throw new Error(`${newEmail} already has an auth account (${accountClash.id}).`);

  const now = new Date().toISOString();

  user.name = newName;
  user.email = newEmail;
  account.email = newEmail;
  account.updatedAt = now;
  console.log(`renamed to: ${newName} <${newEmail}> (auth account email moved too)`);

  // The owner string, not a foreign key — see the header.
  const ownedContacts = state.contacts.filter((contact) => contact.owner === oldName);
  for (const contact of ownedContacts) {
    contact.owner = newName;
    contact.updatedAt = now;
  }
  const assigned = state.sdrAssignments.filter((item) => item.assignedSdrId === userId).length;
  console.log(`contacts with owner "${oldName}" renamed: ${ownedContacts.length} (assignments on this seat: ${assigned})`);

  if (clearTelephony) {
    const had = Boolean(user.ringCentralJwt || user.ringCentralPhoneNumber || user.ringCentralCallerId);
    user.ringCentralPhoneNumber = undefined;
    user.ringCentralCallerId = undefined;
    user.ringCentralExtensionId = undefined;
    user.ringCentralJwt = undefined;
    console.log(`telephony: cleared${had ? "" : " (nothing was set)"} — set it again at /access`);
  } else {
    console.log(
      `telephony: KEPT phone=${user.ringCentralPhoneNumber ?? "none"} callerId=${user.ringCentralCallerId ?? "none"} jwt=${user.ringCentralJwt ? "set" : "none"}`
    );
  }

  if (deleteDailyReports) {
    const before = state.sdrDailyReports.length;
    state.sdrDailyReports = state.sdrDailyReports.filter((report) => report.sdrUserId !== userId);
    console.log(`daily reports deleted: ${before - state.sdrDailyReports.length}`);
  } else {
    const kept = state.sdrDailyReports.filter((report) => report.sdrUserId === userId).length;
    console.log(`daily reports kept: ${kept} (they now display under "${newName}")`);
  }

  const liveSessions = state.authSessions.filter(
    (item) => item.userId === userId && !item.revokedAt && Date.parse(item.expiresAt) > Date.parse(now)
  ).length;
  console.log(
    liveSessions
      ? `⚠ ${liveSessions} active session(s) still signed in as this user — reset the password at /access to revoke them.`
      : "active sessions: none"
  );

  if (!apply) {
    console.log("\nDRY RUN - nothing written. Re-run with RENAME_APPLY=1 to apply.");
    return;
  }

  await writeState(state);
  console.log("\nApplied.");
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
