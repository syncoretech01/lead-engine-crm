import { Prisma, type PrismaClient } from "@prisma/client";
import type { GrowthPrismaClient } from "@/lib/growth/repositories/client";

export const DEFAULT_GROWTH_TRANSACTION_ATTEMPTS = 3;

export function isGrowthTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return candidate.code === "P2034" || candidate.code === "40001" || candidate.meta?.code === "40001";
}

/**
 * Run one Growth OS state transition at PostgreSQL SERIALIZABLE isolation.
 * Prisma transaction and PostgreSQL serialization failures are retried with the
 * same deterministic business identities, so retry cannot mint a second event.
 */
export async function runSerializableGrowthTransaction<T>(
  db: GrowthPrismaClient,
  operation: (tx: GrowthPrismaClient) => Promise<T>,
  attempts = DEFAULT_GROWTH_TRANSACTION_ATTEMPTS
): Promise<T> {
  if (!("$transaction" in db)) return operation(db);

  let lastError: unknown;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      return await (db as PrismaClient).$transaction((tx) => operation(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      lastError = error;
      if (!isGrowthTransactionConflict(error) || attempt === Math.max(1, attempts)) throw error;
    }
  }
  throw lastError;
}
