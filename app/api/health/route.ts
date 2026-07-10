import { prisma } from "@/lib/prisma";

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
    const snapshot = await prisma.appStateSnapshot.findFirst({
      select: { version: true, updatedAt: true }
    });

    const now = Date.now();
    return Response.json(
      {
        status: "ok",
        db: "up",
        latencyMs: now - startedAt,
        snapshotVersion: snapshot?.version ?? null,
        snapshotAgeSeconds: snapshot ? Math.round((now - snapshot.updatedAt.getTime()) / 1000) : null
      },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      {
        status: "error",
        db: "down",
        message: error instanceof Error ? error.message : "unknown error"
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
