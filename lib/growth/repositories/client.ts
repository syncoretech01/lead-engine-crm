import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Shared plumbing for the Growth OS transactional repositories.
 *
 * Every repository in this directory follows the `lib/phase1/auth-fast-path.ts`
 * precedent: lazy Prisma import, an optional client parameter so a caller can
 * enlist the write in an outer transaction, and `workspaceId` in every `where`.
 *
 * 🔴 None of these repositories may write through `updateState`, and none of
 * their tables may enter the projection. See the header block in
 * prisma/schema.prisma and golden rule 1 in CLAUDE.md.
 */

/** A full client or a transaction handle — repositories accept either. */
export type GrowthPrismaClient = PrismaClient | Prisma.TransactionClient;

/**
 * Lazy import, matching the auth fast path. Keeps Prisma out of the module
 * graph of anything that merely imports a type from here.
 */
export const growthPrisma = async (): Promise<PrismaClient> =>
  (await import("@/lib/prisma")).prisma;

/**
 * Run `fn` inside a transaction when given a full client, or inline when the
 * caller already handed us a transaction handle.
 *
 * Nesting `$transaction` inside an open transaction is an error in Prisma, so
 * the check is on the handle rather than a flag the caller has to remember.
 */
export async function inGrowthTransaction<T>(
  db: GrowthPrismaClient,
  fn: (tx: GrowthPrismaClient) => Promise<T>
): Promise<T> {
  return "$transaction" in db ? await (db as PrismaClient).$transaction((tx) => fn(tx)) : await fn(db);
}

/**
 * Server-side pagination for every Growth OS read model (golden rule 11).
 *
 * The legacy read models cap at `take: 500` / `take: 1500` — a cap silently
 * truncates and the caller cannot tell a full page from a clipped one. These
 * page instead, and `nextCursor` is null exactly when the data ran out.
 */
export const GROWTH_PAGE_SIZE_DEFAULT = 50;
export const GROWTH_PAGE_SIZE_MAX = 200;

export type GrowthPageRequest = {
  /** Opaque cursor — the id of the last row of the previous page. */
  cursor?: string;
  pageSize?: number;
};

export type GrowthPage<T> = {
  rows: T[];
  /** Null when there is no further page. Never a count — counts cost a scan. */
  nextCursor: string | null;
};

/** Clamp so a caller cannot ask for the whole table by passing a huge pageSize. */
export function resolvePageSize(requested?: number): number {
  if (!requested || requested < 1) return GROWTH_PAGE_SIZE_DEFAULT;
  return Math.min(requested, GROWTH_PAGE_SIZE_MAX);
}

/**
 * Take one more row than asked for; its presence is what proves another page
 * exists, without a second count query.
 */
export function buildPage<T extends { id: string }>(rows: T[], pageSize: number): GrowthPage<T> {
  if (rows.length <= pageSize) return { rows, nextCursor: null };
  const page = rows.slice(0, pageSize);
  return { rows: page, nextCursor: page[page.length - 1]?.id ?? null };
}

/**
 * Cursor clause shared by every paginated read model.
 *
 * The return type is one object with optional members rather than a union of
 * `{cursor, skip}` and `{}` — a union does not spread into Prisma's findMany
 * args, because TS cannot prove the empty branch satisfies the required shape.
 */
export function cursorArgs(cursor?: string): { cursor?: { id: string }; skip?: number } {
  return cursor ? { cursor: { id: cursor }, skip: 1 } : {};
}
