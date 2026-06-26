const PERSONAL_EMAIL_DOMAINS = new Set([
  "aol.com",
  "comcast.net",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "ymail.com"
]);

const PLACEHOLDER_PERSON_NAMES = new Set([
  "",
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "unknown contact",
  "test",
  "user"
]);

const PLACEHOLDER_COMPANY_NAMES = new Set([
  "",
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "unknown company",
  "individual",
  "individual contact",
  "individual contacts",
  "personal contact",
  "personal contacts"
]);

export function domainFromEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domain.replace(/^www\./, "");
}

export function isPersonalEmailDomain(domain: string) {
  return PERSONAL_EMAIL_DOMAINS.has(domain.trim().toLowerCase().replace(/^www\./, ""));
}

export function isPlaceholderPersonName(value: string | undefined | null) {
  return PLACEHOLDER_PERSON_NAMES.has(normalizePlaceholder(value));
}

export function isPlaceholderCompanyName(value: string | undefined | null) {
  return PLACEHOLDER_COMPANY_NAMES.has(normalizePlaceholder(value));
}

export function isMeaningfulPersonName(value: string | undefined | null) {
  const normalized = normalizePlaceholder(value);
  if (isPlaceholderPersonName(normalized)) {
    return false;
  }

  return normalized.length >= 3 && /[a-z]/.test(normalized);
}

export function isMeaningfulCompanyName(value: string | undefined | null) {
  const normalized = normalizePlaceholder(value);
  if (isPlaceholderCompanyName(normalized)) {
    return false;
  }

  return normalized.length >= 2 && /[a-z0-9]/.test(normalized);
}

export function displayNameFromEmail(email: string) {
  const localPart = email.trim().split("@")[0] ?? "";
  const cleaned = localPart
    .replace(/[._+-]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 3 || /^(info|sales|support|admin|hello|contact)$/i.test(cleaned)) {
    return "";
  }

  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizePlaceholder(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
