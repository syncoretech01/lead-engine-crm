import { getSession } from "@/lib/phase1/store";

export const dynamic = "force-dynamic";

// Serve a user's profile picture. Any authenticated user may view an avatar
// (low-sensitivity, same product). Returns 404 when none is set, so the client
// <AvatarImage> falls back to initials automatically.
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  await getSession(); // require an authenticated session
  const { userId } = await params;

  const { prisma } = await import("@/lib/prisma");
  const avatar = await prisma.userAvatar.findUnique({ where: { userId } });
  if (!avatar) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(Buffer.from(avatar.data), {
    status: 200,
    headers: {
      "Content-Type": avatar.contentType,
      // Short cache; the settings page cache-busts with ?v= right after an upload.
      "Cache-Control": "private, max-age=60",
      "Content-Length": String(avatar.data.length)
    }
  });
}
