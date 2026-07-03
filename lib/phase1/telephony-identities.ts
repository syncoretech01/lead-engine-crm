import type { User } from "@/lib/phase1/types";

export type TelephonyIdentity = {
  displayName: string;
  email: string;
  provider: "RingCentral";
  phoneNumber: string;
  /** RingCentral extension id used to place RingOut on this user's behalf. */
  extensionId?: string;
  label: string;
};

/** The user shape the resolver reads — full User works, so does a name/email pick. */
type TelephonyUser = Pick<User, "name" | "email"> &
  Partial<Pick<User, "ringCentralPhoneNumber" | "ringCentralExtensionId">>;

type KnownTelephonyIdentity = {
  displayName: string;
  email: string;
  nameAliases: string[];
  emailAliases: string[];
  phoneEnvVar: string;
};

const knownTelephonyIdentities: KnownTelephonyIdentity[] = [
  {
    displayName: "Sam Carter",
    email: "sam@syncoretech.com",
    nameAliases: ["sam carter"],
    emailAliases: ["sam@syncoretech.com"],
    phoneEnvVar: "SYNCORE_RINGCENTRAL_SAM_PHONE_NUMBER"
  }
];

export function resolveUserTelephonyIdentity(
  user: TelephonyUser,
  env: NodeJS.ProcessEnv = process.env
): TelephonyIdentity | undefined {
  // Prefer the user's own provisioned RingCentral line (the multi-SDR path).
  const perUserNumber = normalizePhoneNumber(user.ringCentralPhoneNumber);
  if (perUserNumber) {
    return {
      displayName: user.name,
      email: user.email,
      provider: "RingCentral",
      phoneNumber: perUserNumber,
      extensionId: user.ringCentralExtensionId?.trim() || undefined,
      label: `${user.name} <${user.email}> via RingCentral ${perUserNumber}`
    };
  }

  // Fall back to the legacy hardcoded env identity (keeps Sam Carter working
  // until every user is provisioned with their own number).
  const normalizedEmail = normalizeEmail(user.email);
  const normalizedName = normalizeName(user.name);
  const known = knownTelephonyIdentities.find(
    (identity) =>
      identity.emailAliases.some((email) => normalizeEmail(email) === normalizedEmail) ||
      identity.nameAliases.some((name) => normalizeName(name) === normalizedName)
  );

  if (!known) {
    return undefined;
  }

  const phoneNumber = normalizePhoneNumber(env[known.phoneEnvVar]);
  if (!phoneNumber) {
    return undefined;
  }

  return {
    displayName: known.displayName,
    email: known.email,
    provider: "RingCentral",
    phoneNumber,
    label: `${known.displayName} <${known.email}> via RingCentral ${phoneNumber}`
  };
}

export function telephonyIdentityBlockReason(user: Pick<User, "name" | "email">) {
  return `No RingCentral phone number is configured for ${user.name}.`;
}

export function knownTelephonyIdentityViews(env: NodeJS.ProcessEnv = process.env): TelephonyIdentity[] {
  return knownTelephonyIdentities
    .map((identity) => {
      const phoneNumber = normalizePhoneNumber(env[identity.phoneEnvVar]);
      if (!phoneNumber) {
        return undefined;
      }

      return {
        displayName: identity.displayName,
        email: identity.email,
        provider: "RingCentral" as const,
        phoneNumber,
        label: `${identity.displayName} <${identity.email}> via RingCentral ${phoneNumber}`
      };
    })
    .filter((identity): identity is TelephonyIdentity => Boolean(identity));
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizePhoneNumber(value: string | undefined) {
  return value?.trim() || "";
}
