import { isContactCurrentlySuppressed } from "@/lib/phase1/exporting";
import { normalizeEmail, normalizePhone } from "@/lib/phase1/normalization";
import type { AppState } from "@/lib/phase1/types";

export type ContactDetailsUpdateInput = {
  workspaceId: string;
  contactId: string;
  // Presence-based: a field left `undefined` is kept as-is, so a single-field
  // inline edit never blanks the others. Passing "" clears the field.
  name?: string;
  email?: string;
  phone?: string;
  now?: string;
};

export type ContactDetailsUpdateResult = {
  contactId: string;
  companyId: string;
  before: {
    name: string;
    email: string;
    phone: string;
  };
  after: {
    name: string;
    email: string;
    phone: string;
  };
  changedFields: Array<"name" | "email" | "phone">;
  normalizedRecordsUpdated: number;
};

export function updateContactDetailsForWorkspace(
  state: AppState,
  input: ContactDetailsUpdateInput
): ContactDetailsUpdateResult {
  const contact = state.contacts.find(
    (item) => item.id === input.contactId && item.workspaceId === input.workspaceId
  );

  if (!contact) {
    throw new Error("Contact not found.");
  }

  const nextName = input.name !== undefined ? input.name.trim() : contact.name;
  if (!nextName) {
    throw new Error("Contact name is required.");
  }

  const nextEmail =
    input.email !== undefined ? normalizeEditableEmail(input.email) : contact.email;
  const nextPhone =
    input.phone !== undefined ? normalizeEditablePhone(input.phone) : contact.phone;
  const before = {
    name: contact.name,
    email: contact.email,
    phone: contact.phone
  };
  const after = {
    name: nextName,
    email: nextEmail,
    phone: nextPhone
  };
  const now = input.now ?? new Date().toISOString();

  contact.name = after.name;
  contact.email = after.email;
  contact.phone = after.phone;
  contact.updatedAt = now;

  // If the edited email/phone now matches a workspace suppression record, mark the
  // contact suppressed so a later send/export can't reach the opted-out address.
  // Sticky: only sets, never clears (other suppression reasons must persist).
  if (isContactCurrentlySuppressed(state, contact)) {
    contact.isSuppressed = true;
  }

  let normalizedRecordsUpdated = 0;
  for (const record of state.normalizedRecords) {
    if (record.workspaceId !== input.workspaceId) continue;

    const matchedRecord =
      record.duplicateContactId === contact.id ||
      Boolean(before.email && record.email.toLowerCase() === before.email.toLowerCase()) ||
      Boolean(before.name && record.contactName.toLowerCase() === before.name.toLowerCase());

    if (!matchedRecord) continue;

    record.contactName = after.name;
    record.email = after.email;
    record.phone = after.phone;
    record.normalizedAt = now;
    normalizedRecordsUpdated += 1;
  }

  const changedFields = (["name", "email", "phone"] as const).filter((field) => before[field] !== after[field]);

  return {
    contactId: contact.id,
    companyId: contact.companyId,
    before,
    after,
    changedFields,
    normalizedRecordsUpdated
  };
}

function normalizeEditableEmail(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = normalizeEmail(trimmed);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Enter a valid email address.");
  }

  return normalized;
}

function normalizeEditablePhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10) {
    throw new Error("Enter a valid phone number.");
  }

  return normalizePhone(trimmed);
}
