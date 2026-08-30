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
  // When the curated address is NOT allowed, the whole curated entry is
  // discarded — name included — and the user sends as themselves. Keeping the
  // curated display name while rejecting its address would lend "Bobby Jones" to
  // whoever set that profile name.
  //
  // An earlier version tried to tell "same person, new domain" from "someone
  // wearing their name" by comparing the mailbox local part. It cannot: the
  // curated entries are matched by NAME, and firstname.lastname@ is the most
  // common corporate convention there is, so bobby.jones@lookalike was refused
  // outright — locking out all three of the people who actually send, on the
  // exact deploy that is supposed to unblock them.
  //
  // The residual is that display names are self-service, so a user can set their
  // name to a colleague's. That is true of every non-curated user already; the
  // real gates are the domain allow-list here and the send_direct_outreach
  // permission, not the display string.
  const knownEmail = known ? normalizeEmail(known.email) : "";
  const curatedAllowed = Boolean(knownEmail) && isAllowedSenderEmail(knownEmail, env);
  const displayName = (curatedAllowed ? known!.displayName : user.name).trim();
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

