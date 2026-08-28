import { prisma } from "@/lib/prisma";
import { getNotifyOutboxHealth } from "@/lib/growth/notify-outbox";

// Liveness/readiness probe for external uptime monitoring and deploy verification.
// Intentionally unauthenticated and cheap: a single-row DB round-trip plus snapshot
// freshness — no whole-blob read. Returns 503 if the database is unreachable so an
// uptime check (and the deploy script) can page on a wedged box instead of relying
// on a human noticing (the 2026-07-09 OOM outage was detected by a person).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();

  try {
    const now = new Date();
    const [snapshot, notifyOutbox] = await Promise.all([
      prisma.appStateSnapshot.findFirst({
        select: { version: true, updatedAt: true }
      }),
      getNotifyOutboxHealth(now, prisma)
    ]);

    const nowMs = now.getTime();
    return Response.json(
      {
        status: "ok",
        db: "up",
        latencyMs: nowMs - startedAt,
        snapshotVersion: snapshot?.version ?? null,
        snapshotAgeSeconds: snapshot
          ? Math.round((nowMs - snapshot.updatedAt.getTime()) / 1000)
          : null,
        notifyOutbox
      },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    console.error("[health] database check failed:", error instanceof Error ? error.message : error);
    return Response.json(
      {
        status: "error",
        db: "down",
        // Deliberately generic: Prisma connection errors embed the database
        // host, and this endpoint is public so an uptime monitor can read it.
        // The real error goes to the server log.
        message: "database unavailable"
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
