"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { defaultWorkspacePath } from "@/lib/phase1/auth";
import {
  acceptUserInvite,
  createPasswordResetToken,
  createUserInvite,
  deactivateUserAccount,
  loginWithPassword,
  resetPasswordWithToken,
  revokeAuthSession,
  switchAuthWorkspace,
  updateMemberRole
} from "@/lib/phase1/auth-service";
import {
  authCookieOptions,
  authSessionCookieName,
  expiredAuthCookieOptions
} from "@/lib/phase1/auth-security";
import { authWriteTables } from "@/lib/phase1/normalized-write-tables";
import { getSession, updateAuthState, updateState } from "@/lib/phase1/store";
import type { WorkspaceRole } from "@/lib/phase1/types";

export async function loginAction(formData: FormData) {
  const email = stringValue(formData.get("email"));
  const password = stringValue(formData.get("password"));
  const next = safeNextPath(stringValue(formData.get("next")));
  let result;

  try {
    result = await updateAuthState(
      (state) => loginWithPassword(state, { email, password }),
      { normalizedTables: authWriteTables }
    );
  } catch (error) {
    redirect(`/login?error=${encodeURIComponent(errorMessage(error))}&next=${encodeURIComponent(next)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(authSessionCookieName, result.cookieValue, authCookieOptions(result.expiresAt));
  redirect(next || defaultWorkspacePath(result.session));
}

export async function logoutAction() {
  const session = await getSession();
  await updateAuthState((state) => {
    if (session.authSessionId) {
      revokeAuthSession(state, session.authSessionId);
    }
  }, { normalizedTables: authWriteTables });
  const cookieStore = await cookies();
  cookieStore.set(authSessionCookieName, "", expiredAuthCookieOptions());
  redirect("/login?loggedOut=1");
}

export async function switchWorkspaceAction(formData: FormData) {
  const workspaceId = stringValue(formData.get("workspaceId"));
  let nextPath = "/";
  const result = await updateState((state, session) => {
    const switched = switchAuthWorkspace(state, session, workspaceId);
    nextPath = defaultWorkspacePath(switched.session);
    return switched;
  }, { normalizedTables: authWriteTables });

  const cookieStore = await cookies();
  cookieStore.set(authSessionCookieName, result.cookieValue, authCookieOptions(result.expiresAt));
  redirect(nextPath);
}

export async function createUserInviteAction(formData: FormData) {
  let inviteUrl = "";
  await updateState((state, session) => {
    const invite = createUserInvite(state, session, {
      email: stringValue(formData.get("email")),
      role: roleValue(formData.get("role"))
    });
    inviteUrl = invite.url;
  }, { normalizedTables: authWriteTables });

  revalidatePath("/access");
  redirect(`/access?invite=${encodeURIComponent(inviteUrl)}`);
}

export async function acceptInviteAction(formData: FormData) {
  const token = stringValue(formData.get("token"));
  const name = stringValue(formData.get("name"));
  const password = stringValue(formData.get("password"));
  let result;

  try {
    result = await updateAuthState(
      (state) => acceptUserInvite(state, { token, name, password }),
      { normalizedTables: authWriteTables }
    );
  } catch (error) {
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(errorMessage(error))}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(authSessionCookieName, result.cookieValue, authCookieOptions(result.expiresAt));
  redirect(defaultWorkspacePath(result.session));
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = stringValue(formData.get("email"));
  let resetUrl = "";
  await updateAuthState((state) => {
    resetUrl = createPasswordResetToken(state, email)?.url ?? "";
  }, { normalizedTables: authWriteTables });

  const query = resetUrl ? `?sent=1&reset=${encodeURIComponent(resetUrl)}` : "?sent=1";
  redirect(`/reset-password${query}`);
}

export async function resetPasswordAction(formData: FormData) {
  const token = stringValue(formData.get("token"));
  const password = stringValue(formData.get("password"));

  try {
    await updateAuthState(
      (state) => resetPasswordWithToken(state, { token, password }),
      { normalizedTables: authWriteTables }
    );
  } catch (error) {
    redirect(`/reset-password/${encodeURIComponent(token)}?error=${encodeURIComponent(errorMessage(error))}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(authSessionCookieName, "", expiredAuthCookieOptions());
  redirect("/login?reset=1");
}

export async function updateMemberRoleAction(formData: FormData) {
  await updateState((state, session) => {
    updateMemberRole(state, session, {
      userId: stringValue(formData.get("userId")),
      role: roleValue(formData.get("role"))
    });
  }, { normalizedTables: authWriteTables });

  revalidatePath("/access");
}

export async function deactivateUserAction(formData: FormData) {
  await updateState((state, session) => {
    deactivateUserAccount(state, session, stringValue(formData.get("userId")));
  }, { normalizedTables: authWriteTables });

  revalidatePath("/access");
}

function stringValue(value: FormDataEntryValue | null, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function roleValue(value: FormDataEntryValue | null): WorkspaceRole {
  const role = stringValue(value);
  if (
    role === "Admin" ||
    role === "Manager" ||
    role === "SDR" ||
    role === "Data Operator" ||
    role === "Viewer" ||
    role === "Compliance Admin"
  ) {
    return role;
  }

  return "Viewer";
}

function safeNextPath(value: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
