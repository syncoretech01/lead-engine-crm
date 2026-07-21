/**
 * Phone search deliberately ignores presentation characters. CRM phones may be
 * rendered as "+1 301 201 0899" while a user pastes "(301) 201-0899" or types
 * only the local digits. The comparison also treats the leading US country code
 * as optional.
 */
export function phoneSearchDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function isPhoneSearchQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /[a-z]/i.test(trimmed)) return false;
  return phoneSearchDigits(trimmed).length >= 3;
}

export function phoneMatchesSearch(phone: string | null | undefined, query: string) {
  if (!isPhoneSearchQuery(query)) return false;

  const phoneDigits = phoneSearchDigits(phone);
  const queryDigits = phoneSearchDigits(query);
  if (!phoneDigits) return false;

  const localPhone = withoutUsCountryCode(phoneDigits);
  const localQuery = withoutUsCountryCode(queryDigits);

  return (
    phoneDigits.includes(queryDigits) ||
    localPhone.includes(localQuery) ||
    (localQuery.length >= 10 && localQuery.includes(localPhone))
  );
}

/** Exact phone identity comparison for provider callbacks. Presentation and an
 * optional leading North-American country code do not change the identity. */
export function phoneNumbersEquivalent(
  first: string | null | undefined,
  second: string | null | undefined
) {
  const firstDigits = withoutUsCountryCode(phoneSearchDigits(first));
  const secondDigits = withoutUsCountryCode(phoneSearchDigits(second));
  return firstDigits.length >= 7 && firstDigits === secondDigits;
}

export function textOrPhoneMatchesSearch(
  value: unknown,
  phone: string | null | undefined,
  query: string
) {
  const needle = query.trim().toLowerCase();
  return String(value ?? "").toLowerCase().includes(needle) || phoneMatchesSearch(phone, needle);
}

function withoutUsCountryCode(value: string) {
  return value.length === 11 && value.startsWith("1") ? value.slice(1) : value;
}
