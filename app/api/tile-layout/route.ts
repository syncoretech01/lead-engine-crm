import { isTilePageKey, saveUserTileLayout } from "@/lib/phase1/tile-layouts";
import type { TileLayoutItem } from "@/lib/phase1/types";

export const dynamic = "force-dynamic";

// Durable target for navigator.sendBeacon: persists the current user's tile
// layout when the page is being hidden/unloaded (server actions are not reliably
// delivered during unload). Auth + workspace scoping are enforced by
// saveUserTileLayout -> updateState (resolves the session from request cookies).
export async function POST(request: Request) {
  let payload: { pageKey?: unknown; items?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const pageKey = typeof payload.pageKey === "string" ? payload.pageKey : "";
  if (!isTilePageKey(pageKey)) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const items = Array.isArray(payload.items) ? (payload.items as TileLayoutItem[]) : [];

  try {
    await saveUserTileLayout(pageKey, items);
  } catch {
    // Unauthenticated or transient write failure — the beacon response is not
    // observed by the client, so just signal failure.
    return Response.json({ ok: false }, { status: 401 });
  }

  return Response.json({ ok: true });
}
