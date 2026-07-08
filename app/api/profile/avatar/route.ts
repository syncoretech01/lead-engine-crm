import { getSession } from "@/lib/phase1/store";

export const dynamic = "force-dynamic";

// Profile-picture bytes live in the dedicated UserAvatar table (not the AppState
// blob). Uploads always target the signed-in user's own row — a caller can never
// write another user's avatar. Client resizes to ~256px before upload.
const MAX_BYTES = 1_500_000; // 1.5 MB, post-resize headroom
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const session = await getSession();
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No image provided." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: "Use a JPEG, PNG, or WebP image." }, { status: 400 });
  }
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length === 0) {
    return Response.json({ error: "The image was empty." }, { status: 400 });
  }
  if (data.length > MAX_BYTES) {
    return Response.json({ error: "Image is too large. Please pick one under ~1.5 MB." }, { status: 400 });
  }

  const { prisma } = await import("@/lib/prisma");
  await prisma.userAvatar.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, contentType: file.type, data },
    update: { contentType: file.type, data }
  });

  return Response.json({ ok: true });
}

export async function DELETE() {
  const session = await getSession();
  const { prisma } = await import("@/lib/prisma");
  await prisma.userAvatar.deleteMany({ where: { userId: session.user.id } });
  return Response.json({ ok: true });
}
