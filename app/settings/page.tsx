import { KeyRound, Mail, UserCog } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/ui/panel";
import { fieldClass, fieldLabelClass, fieldTextareaClass } from "@/components/ui/field";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { AvatarUploader } from "@/components/settings/avatar-uploader";
import { workspaceRoleLabel } from "@/lib/phase1/auth";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";
import { updateProfileAction, changePasswordAction } from "@/app/settings/actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Common IANA zones offered in the picker. The user's current value is always
// added below if it isn't already here, so an unusual saved zone still shows.
const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Chicago", label: "Central — Chicago" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Phoenix", label: "Mountain (no DST) — Phoenix" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
  { value: "America/Toronto", label: "Eastern — Toronto" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Central Europe — Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Karachi", label: "Karachi" },
  { value: "Asia/Kolkata", label: "India — Kolkata" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Manila", label: "Manila" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" }
];

export default async function SettingsPage() {
  const { session } = await getWorkspaceSessionContext();
  const user = session.user;

  let hasAvatar = false;
  if (resolveStorageDriver() === "prisma") {
    const { prisma } = await import("@/lib/prisma");
    hasAvatar = Boolean(
      await prisma.userAvatar.findUnique({ where: { userId: user.id }, select: { userId: true } })
    );
  }

  const currentTz = user.timezone ?? "";
  const tzOptions = currentTz && !TIMEZONES.some((tz) => tz.value === currentTz)
    ? [{ value: currentTz, label: currentTz }, ...TIMEZONES]
    : TIMEZONES;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        kicker="Account"
        title="Settings"
        copy="Manage your profile, sign-in security, and personal preferences."
      />

      {/* Profile: picture + display name */}
      <Panel
        title="Profile"
        subtitle="Your photo and display name — shown across the CRM."
        action={<UserCog className="size-4 text-muted-foreground" aria-hidden="true" />}
      >
        <div className="flex flex-col gap-6">
          <AvatarUploader userId={user.id} name={user.name} hasAvatar={hasAvatar} />

          <ActionForm action={updateProfileAction} successMessage="Profile updated" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className={fieldLabelClass}>
                Display name
              </label>
              <input id="name" name="name" type="text" required defaultValue={user.name} className={fieldClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabelClass}>Email</span>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="size-4" aria-hidden="true" />
                <span>{user.email}</span>
                <span className="rounded-md border px-1.5 py-0.5 text-xs">
                  {workspaceRoleLabel(session.role)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Your sign-in email is managed by an admin. Ask them to change it.
              </p>
            </div>
            <div>
              <SubmitButton>Save profile</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </Panel>

      {/* Preferences: email signature + timezone */}
      <Panel
        title="Preferences"
        subtitle="Personal defaults for your outbound email and how times appear to you."
        action={<Mail className="size-4 text-muted-foreground" aria-hidden="true" />}
      >
        <ActionForm action={updateProfileAction} successMessage="Preferences saved" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="emailSignature" className={fieldLabelClass}>
              Email signature
            </label>
            <textarea
              id="emailSignature"
              name="emailSignature"
              rows={4}
              defaultValue={user.emailSignature ?? ""}
              placeholder={`Best,\n${user.name}`}
              className={fieldTextareaClass}
            />
            <p className="text-xs text-muted-foreground">
              Appended to the emails you send from the CRM. Leave blank for none.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timezone" className={fieldLabelClass}>
              Timezone
            </label>
            <select id="timezone" name="timezone" defaultValue={currentTz} className={cn(fieldClass, "w-full max-w-sm")}>
              <option value="">Not set (use system default)</option>
              {tzOptions.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Dates on your pages show in this timezone.</p>
          </div>
          <div>
            <SubmitButton>Save preferences</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      {/* Security: change password */}
      <Panel
        title="Security"
        subtitle="Change the password you use to sign in."
        action={<KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />}
      >
        <ActionForm action={changePasswordAction} successMessage="Password changed" className="flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="currentPassword" className={fieldLabelClass}>
              Current password
            </label>
            <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className={fieldClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="newPassword" className={fieldLabelClass}>
              New password
            </label>
            <input id="newPassword" name="newPassword" type="password" required minLength={10} autoComplete="new-password" className={fieldClass} />
            <p className="text-xs text-muted-foreground">At least 10 characters.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirmPassword" className={fieldLabelClass}>
              Confirm new password
            </label>
            <input id="confirmPassword" name="confirmPassword" type="password" required minLength={10} autoComplete="new-password" className={fieldClass} />
          </div>
          <p className="text-xs text-muted-foreground">
            Changing your password signs out your other devices.
          </p>
          <div>
            <SubmitButton>Change password</SubmitButton>
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}
