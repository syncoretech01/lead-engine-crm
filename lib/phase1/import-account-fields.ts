import { randomUUID } from "node:crypto";

import type { AppState, CustomField } from "@/lib/phase1/types";

/** One "Key account fields" row: a label and how to read it out of a sheet row. */
export type ImportAccountField = {
  label: string;
  from: (row: Record<string, string>) => string;
  fieldType?: CustomField["fieldType"];
};

export type ImportAccountFieldStats = {
  definitions: number;
  accountsMatched: number;
  valuesWritten: number;
};

/**
 * Attaches a sheet's non-core columns to the account as custom fields, which is
 * what the dossier's "Key account fields" card renders.
 *
 * Account-scoped, not contact-scoped, on purpose: `readKeyAccountFields` looks up
 * values by company id, so a contact-scoped value is written but never shown.
 * These columns describe the business (address, rating, category) rather than a
 * person, so the account is also where they belong.
 *
 * Definitions with the same name are reused, so a re-run updates values instead
 * of duplicating the field set.
 */
export function attachImportAccountFields(
  state: AppState,
  workspaceId: string,
  rows: Array<Record<string, string>>,
  fields: ImportAccountField[],
  companyNameColumn: string,
  nowIso: string
): ImportAccountFieldStats {
  const byCompanyName = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const key = (row[companyNameColumn] ?? "").trim().toLowerCase();
    if (key && !byCompanyName.has(key)) byCompanyName.set(key, row);
  }

  const fieldIdByLabel = new Map<string, string>();
  for (const { label, fieldType } of fields) {
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
      fieldType: fieldType ?? "text",
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
    for (const { label, from } of fields) {
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
