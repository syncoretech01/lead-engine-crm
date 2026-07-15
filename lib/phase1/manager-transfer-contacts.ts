import { resolveStorageDriver } from "@/lib/phase1/storage-driver";

// Standalone "Transfer to manager" lines — a manager reachable for a mid-call
// blind transfer WITHOUT a CRM login. Stored per-workspace on the generic,
// otherwise-unused Integration config row (Prisma-native; never in AppState), so
// there's no schema migration and no blob/XOR involvement. The Focus dock's
// transfer panel lists these alongside Manager/Admin users who have a phone set.
export const MANAGER_TRANSFER_PROVIDER = "manager-transfer-lines";

export type ManagerTransferContact = {
  id: string;
  name: string;
  phoneNumber: string;
};

/** Normalize a typed number toward E.164 (US-friendly), matching the dialer. */
export function normalizeTransferNumber(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return `+${raw.slice(1).replace(/[^\d]/g, "")}`;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/** Parse the Integration config JSON into a clean, validated contact list. */
export function parseTransferContacts(config: unknown): ManagerTransferContact[] {
  const list = (config as { contacts?: unknown } | null)?.contacts;
  if (!Array.isArray(list)) return [];
  const out: ManagerTransferContact[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const id = typeof c.id === "string" ? c.id : "";
    const name = typeof c.name === "string" ? c.name.trim() : "";
    const phoneNumber = typeof c.phoneNumber === "string" ? c.phoneNumber.trim() : "";
    if (id && name && phoneNumber) out.push({ id, name, phoneNumber });
  }
  return out;
}

/** Read a workspace's configured transfer lines (Prisma-native; [] off prisma). */
export async function readManagerTransferContacts(workspaceId: string): Promise<ManagerTransferContact[]> {
  if (resolveStorageDriver() !== "prisma") return [];
  const { prisma } = await import("@/lib/prisma");
  const row = await prisma.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: MANAGER_TRANSFER_PROVIDER } },
    select: { config: true }
  });
  return parseTransferContacts(row?.config);
}
