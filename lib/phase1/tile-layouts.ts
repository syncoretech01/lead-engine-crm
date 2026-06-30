import { randomUUID } from "node:crypto";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { readState, stateSnapshotId, updateState } from "@/lib/phase1/store";
import type { Session, TileLayoutItem, UserTileLayout } from "@/lib/phase1/types";

// Pages that support per-user, draggable/resizable tile layouts. Detail pages
// share a single key across records (layout is per page type, not per record).
export const TILE_PAGE_KEYS = [
  "sdr-queue",
  "sdr-manager",
  "crm-account-detail",
  "crm-contact-detail",
  "crm-accounts",
  "crm-contacts"
] as const;

export type TilePageKey = (typeof TILE_PAGE_KEYS)[number];

export function isTilePageKey(value: string): value is TilePageKey {
  return (TILE_PAGE_KEYS as readonly string[]).includes(value);
}

// Tile customization is scoped to the SDR team (reps and their managers) — the
// SDR queue is used by both, and the manager dashboard is manager-only. Kept as
// a single helper so the gate is trivial to widen to other roles later.
export function canCustomizeTiles(session: Pick<Session, "role">): boolean {
  return session.role === "SDR" || session.role === "Manager";
}

function clampTileInt(value: unknown, min: number, max: number): number {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) {
    return min;
  }
  return Math.min(Math.max(rounded, min), max);
}

export function sanitizeTileItems(items: TileLayoutItem[]): TileLayoutItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item) => item && typeof item.id === "string" && item.id.length > 0)
    .map((item) => ({
      id: String(item.id),
      x: clampTileInt(item.x, 0, 11),
      y: clampTileInt(item.y, 0, 999),
      w: clampTileInt(item.w, 1, 12),
      h: clampTileInt(item.h, 1, 40)
    }));
}

// Reads the current user's saved layout for a page, or null when none exists.
// Uses a narrow jsonb read on the prisma driver so the fast SDR pages don't have
// to load the full AppState just to fetch a layout.
export async function readUserTileLayout(
  userId: string,
  pageKey: string
): Promise<TileLayoutItem[] | null> {
  if (!isTilePageKey(pageKey)) {
    return null;
  }

  const layouts = await readUserTileLayoutsRaw();
  const match = layouts.find((layout) => layout.userId === userId && layout.pageKey === pageKey);
  return match ? sanitizeTileItems(match.items) : null;
}

async function readUserTileLayoutsRaw(): Promise<UserTileLayout[]> {
  if (resolveStorageDriver() === "prisma") {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.$queryRaw<Array<{ userTileLayouts: unknown }>>`
      SELECT "state"->'userTileLayouts' AS "userTileLayouts"
      FROM "AppStateSnapshot"
      WHERE "id" = ${stateSnapshotId}
      LIMIT 1
    `;
    const value = rows[0]?.userTileLayouts;
    return Array.isArray(value) ? (value as UserTileLayout[]) : [];
  }

  const state = await readState();
  return Array.isArray(state.userTileLayouts) ? state.userTileLayouts : [];
}

// Persists the current request user's layout for a page. Shared by the server
// action and the sendBeacon API route. Writes ONLY the JSON snapshot
// (skipNormalizedProjection) — userTileLayouts is not a normalized table, so a
// tile save must never re-sync the projection (that timed out on Neon).
export async function saveUserTileLayout(pageKey: string, items: TileLayoutItem[]) {
  if (!isTilePageKey(pageKey)) {
    return;
  }
  const clean = sanitizeTileItems(items);
  await updateState(
    (state, session) => {
      if (!Array.isArray(state.userTileLayouts)) {
        state.userTileLayouts = [];
      }
      const userId = session.user.id;
      const existing = state.userTileLayouts.find(
        (layout) => layout.userId === userId && layout.pageKey === pageKey
      );
      if (existing) {
        existing.items = clean;
        existing.updatedAt = new Date().toISOString();
      } else {
        state.userTileLayouts.push({
          id: randomUUID(),
          userId,
          pageKey,
          items: clean,
          updatedAt: new Date().toISOString()
        });
      }
    },
    { skipNormalizedProjection: true }
  );
}

export async function resetUserTileLayout(pageKey: string) {
  if (!isTilePageKey(pageKey)) {
    return;
  }
  await updateState(
    (state, session) => {
      if (!Array.isArray(state.userTileLayouts)) {
        state.userTileLayouts = [];
        return;
      }
      state.userTileLayouts = state.userTileLayouts.filter(
        (layout) => !(layout.userId === session.user.id && layout.pageKey === pageKey)
      );
    },
    { skipNormalizedProjection: true }
  );
}
