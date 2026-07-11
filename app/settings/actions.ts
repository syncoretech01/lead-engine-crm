"use server";

import { revalidatePath } from "next/cache";
import { asActionResult, type ActionResult } from "@/lib/action-result";
import { changeOwnPasswordPrismaFast, updateOwnProfilePrismaFast } from "@/lib/phase1/auth-fast-path";
import { changeOwnPassword, updateOwnProfile } from "@/lib/phase1/auth-service";
import { authWriteTables } from "@/lib/phase1/normalized-write-tables";
import { updateState } from "@/lib/phase1/store";

function str(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

// Self-service profile update (name / signature / timezone). Presence-based:
// each form only submits the fields it owns, so absent fields are left untouched.
export async function updateProfileAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return asActionResult(async () => {
    const patch: { name?: string; emailSignature?: string; timezone?: string } = {};
    if (formData.has("name")) patch.name = str(formData.get("name"));
    // Signature is free-text and may legitimately be cleared — keep it raw (not trimmed to "").
    if (formData.has("emailSignature")) patch.emailSignature = String(formData.get("emailSignature") ?? "");
    if (formData.has("timezone")) patch.timezone = str(formData.get("timezone"));

    const done = await updateOwnProfilePrismaFast(patch);
    if (!done) {
      await updateState((state, session) => {
        updateOwnProfile(state, session, patch);
      }, { normalizedTables: authWriteTables });
    }

    // The display name (and avatar) show in the app shell on every page.
    revalidatePath("/", "layout");
    revalidatePath("/settings");
  }, "Profile updated");
}

export async function changePasswordAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return asActionResult(async () => {
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) {
      throw new Error("New password and confirmation do not match.");
    }

    const done = await changeOwnPasswordPrismaFast({ currentPassword, newPassword });
    if (!done) {
      await updateState((state, session) => {
        changeOwnPassword(state, session, { currentPassword, newPassword });
      }, { normalizedTables: authWriteTables });
    }

    revalidatePath("/settings");
  }, "Password changed");
}
