import type { User } from "@/lib/phase1/types";

export type SenderIdentity = {
  displayName: string;
  email: string;
  mailbox: string;
  replyTo: string;
};

type KnownSenderIdentity = {
  displayName: string;
  email: string;
  nameAliases: string[];
  emailAliases: string[];
};

const knownSenderIdentities: KnownSenderIdentity[] = [
  {
    displayName: "Syncore Tech",
    email: "hello@syncoretech.com",
    nameAliases: ["syncore tech"],
    emailAliases: ["hello@syncoretech.com"]
  },
  {
    displayName: "Bobby Jones",
    email: "bobby@syncoretech.com",
    nameAliases: ["bobby jones"],
    emailAliases: ["bobby@syncoretech.com"]
  },
  {
    displayName: "Sam Carter",
    email: "sam@syncoretech.com",
    nameAliases: ["sam carter"],
    emailAliases: ["sam@syncoretech.com"]
  }
];

export function resolveUserSenderIdentity(
  user: Pick<User, "name" | "email">,
  env: NodeJS.ProcessEnv = process.env
): SenderIdentity | undefined {
  const normalizedEmail = normalizeEmail(user.email);
  const normalizedName = normalizeName(user.name);
  const known = knownSenderIdentities.find(
    (identity) =>
      identity.emailAliases.some((email) => normalizeEmail(email) === normalizedEmail) ||
      identity.nameAliases.some((name) => normalizeName(name) === normalizedName)
  );

  // The sending address must be on an allowed (SES-verified) domain — that
  // domain check is the real gate, so any member on it can send as themselves
  // without being hardcoded here. Who is *allowed* to send is enforced
  // separately by the send_direct_outreach permission.
  //
  // The curated identity only wins while its address is on an allowed domain.
  // It is matched by NAME as well as email, so pinning to the hardcoded address
  // unconditionally would keep a rep on @syncoretech.com even after the operator
  // moves them to a lookalike domain and allow-lists it — which makes golden
  // rule 13 unsatisfiable for exactly the three identities that do the sending.
  //
  // When the curated address is NOT allowed, falling through to the user's own
  // address has to answer a second question: is this the same person on a new
  // domain, or someone else wearing their name? `name` is self-service
  // (app/settings/actions.ts), so a plain fallback would let anyone who renames
  // themselves "Bobby Jones" send as Bobby Jones from their own allowed address.
  // The mailbox local part decides it: "sam" moving to sam@lookalike is the same
  // person; "mallory" claiming Bobby's name is not.
  const knownEmail = known ? normalizeEmail(known.email) : "";
  const curatedAllowed = Boolean(knownEmail) && isAllowedSenderEmail(knownEmail, env);
  if (known && !curatedAllowed && mailboxLocalPart(knownEmail) !== mailboxLocalPart(normalizedEmail)) {
    return undefined;
  }

  const displayName = (known?.displayName ?? user.name).trim();
  const email = curatedAllowed ? knownEmail : normalizedEmail;

  if (!email || !isAllowedSenderEmail(email, env)) {
    return undefined;
  }

  const replyTo = senderReplyTo(email, env);
  return {
    displayName: displayName || email,
    email,
    mailbox: formatMailbox(displayName || email, email),
    replyTo,
  };
}

export function senderIdentityBlockReason(user: Pick<User, "name" | "email">) {
  return `No approved sending email is configured for ${user.name}.`;
}

export function knownSenderIdentityViews(env: NodeJS.ProcessEnv = process.env): SenderIdentity[] {
  return knownSenderIdentities
    .filter((identity) => isAllowedSenderEmail(identity.email, env))
    .map((identity) => ({
      displayName: identity.displayName,
      email: identity.email,
      mailbox: formatMailbox(identity.displayName, identity.email),
      replyTo: senderReplyTo(identity.email, env)
    }));
}

function senderReplyTo(email: string, env: NodeJS.ProcessEnv) {
  return env.SYNCORE_SDR_REPLY_TO?.trim() || email;
}

function isAllowedSenderEmail(email: string, env: NodeJS.ProcessEnv) {
  const allowedDomains = (env.SYNCORE_ALLOWED_SENDER_DOMAINS || "syncoretech.com")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  const domain = email.split("@")[1]?.toLowerCase();
  return Boolean(domain && allowedDomains.includes(domain));
}

function formatMailbox(displayName: string, email: string) {
  return `${sanitizeDisplayName(displayName)} <${normalizeEmail(email)}>`;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sanitizeDisplayName(value: string) {
  return value.replace(/[<>"\r\n]/g, "").trim();
}

/** The mailbox name, i.e. everything before the "@". */
function mailboxLocalPart(email: string) {
  return email.split("@")[0]?.trim().toLowerCase() ?? "";
}
