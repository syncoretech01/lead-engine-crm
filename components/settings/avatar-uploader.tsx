"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
}

const MAX_DIM = 256;

// Downscale + re-encode the picked image in the browser so we upload a small,
// square-ish JPEG regardless of the source file size.
async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9)
  );
  if (!blob) throw new Error("Could not process image.");
  return blob;
}

export function AvatarUploader({
  userId,
  name,
  hasAvatar
}: {
  userId: string;
  name: string;
  hasAvatar: boolean;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [present, setPresent] = React.useState(hasAvatar);
  // Cache-buster so the <img> re-fetches immediately after an upload/removal.
  const [version, setVersion] = React.useState(0);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    setBusy(true);
    try {
      const resized = await resizeImage(file);
      const body = new FormData();
      body.append("file", resized, "avatar.jpg");
      const res = await fetch("/api/profile/avatar", { method: "POST", body });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Upload failed.");
      }
      setPresent(true);
      setVersion((v) => v + 1);
      toast.success("Profile picture updated");
      router.refresh(); // update the avatar in the app shell (user menu)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove the picture.");
      setPresent(false);
      setVersion((v) => v + 1);
      toast.success("Profile picture removed");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the picture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-5">
      <Avatar className="size-20 rounded-full border">
        {present ? (
          <AvatarImage src={`/api/profile/avatar/${userId}?v=${version}`} alt={name} />
        ) : null}
        <AvatarFallback className="rounded-full bg-primary text-lg font-semibold text-primary-foreground">
          {initials(name)}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onPick}
            disabled={busy}
          />
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {present ? "Change picture" : "Upload picture"}
          </button>
          {present ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={busy}>
              <Trash2 className="size-4" />
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP. Resized to 256px on upload.</p>
      </div>
    </div>
  );
}
