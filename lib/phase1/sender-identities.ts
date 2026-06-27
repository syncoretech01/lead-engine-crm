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

  if (!known || !isAllowedSenderEmail(known.email, env)) {
    return undefined;
  }

  const replyTo = senderReplyTo(known.email, env);
  return {
    displayName: known.displayName,
    email: known.email,
    mailbox: formatMailbox(known.displayName, known.email),
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
