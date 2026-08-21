import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

// The "Key account fields" component (SDR Cockpit §6): the workspace's custom
// fields for an account, rendered identically in the dossier + peeks. Fetched
// generically from the custom-field mechanism so any workspace's field set shows
// (freight brokers get MC#/USDOT/Authority/Bond, etc.). Keyed by account id.
export type KeyAccountField = { label: string; value: string };

// Sized to the widest field set a workspace actually defines. The VA
// no-website import carries 10 account attributes (DBA, mailing address, zip,
// licence start, category, ethnicity, NIGP codes, and three verification
// columns); at 6 the card silently dropped the last four.
const MAX_FIELDS = 12;

export async function readKeyAccountFields(
  workspaceId: string,
  companyIds: string[]
): Promise<Map<string, KeyAccountField[]>> {
  const map = new Map<string, KeyAccountField[]>();
  const ids = [...new Set(companyIds.filter(Boolean))];
  if (resolveStorageDriver() !== "prisma" || ids.length === 0) {
    return map;
  }

  const { prisma } = await import("@/lib/prisma");
  const [fields, values] = await Promise.all([
    prisma.customField.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true }
    }),
    prisma.customFieldValue.findMany({
      where: { workspaceId, objectId: { in: ids } },
      select: { objectId: true, customFieldId: true, value: true }
    })
  ]);

  if (fields.length === 0 || values.length === 0) return map;

  // value keyed by `${accountId}::${fieldId}` for ordered, per-account assembly.
  const valueByObjectField = new Map<string, string>();
  for (const value of values) {
    if (value.value) valueByObjectField.set(`${value.objectId}::${value.customFieldId}`, value.value);
  }

  for (const id of ids) {
    const list: KeyAccountField[] = [];
    for (const field of fields) {
      const value = valueByObjectField.get(`${id}::${field.id}`);
      if (value) list.push({ label: field.name, value });
      if (list.length >= MAX_FIELDS) break;
    }
    if (list.length) map.set(id, list);
  }

  return map;
}
