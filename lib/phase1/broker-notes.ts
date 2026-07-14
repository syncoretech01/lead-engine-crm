// Some workspaces (the broker import) crammed structured account attributes into
// the contact `notes` blob instead of custom fields — so the dossier showed the
// raw dump as the "fit reason" and an empty Key Account Fields card. This parses
// that known format back into structured fields + a clean fit reason + the state
// (for local-time derivation). Returns null when the notes aren't in this format.
//
// Format written by the import (newline-separated):
//   MC# MC-260504 | USDOT 4517595
//   Active authority date: 02/19/2026
//   Authority status: Active
//   Authority type: PROPERTY BROKER
//   Authority action: GRANTED
//   Bond filed: Yes (required: Yes)
//   Address: 725 OPPORTUNITY DR, SAINT CLOUD, MN, 56301-5886

export type ParsedBroker = {
  fields: Array<{ label: string; value: string }>;
  fitReason: string;
  state: string; // 2-letter state code, or ""
  location: string; // "City, ST zip", or ""
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function parseBrokerNotes(notes: string): ParsedBroker | null {
  if (!notes || !/\bMC#|\bUSDOT\b/.test(notes)) return null;

  const line = (re: RegExp) => notes.match(re)?.[1]?.trim() ?? "";
  const mc = line(/MC#\s*([^\s|]+)/);
  const usdot = line(/USDOT\s*([^\s|]+)/);
  const status = line(/Authority status:\s*(.+)/);
  const type = line(/Authority type:\s*(.+)/);
  const bond = line(/Bond filed:\s*(.+)/);
  const address = line(/Address:\s*(.+)/);

  // Address parts: "street, city, ST, zip" → state = the 2-letter uppercase part.
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const state = parts.find((part, index) => index > 0 && /^[A-Z]{2}$/.test(part)) ?? "";
  const stateIndex = state ? parts.indexOf(state) : -1;
  // Compact address for display: "city, ST zip".
  const city = stateIndex > 0 ? parts[stateIndex - 1] : "";
  const zip = stateIndex >= 0 && parts[stateIndex + 1] ? parts[stateIndex + 1] : "";
  const compactAddress = [titleCase(city), [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || address;

  const fields: Array<{ label: string; value: string }> = [];
  if (mc) fields.push({ label: "MC number", value: mc });
  if (usdot) fields.push({ label: "USDOT", value: usdot });
  if (status || type) fields.push({ label: "Authority", value: [status, type].filter(Boolean).join(" · ") });
  if (bond) fields.push({ label: "Bond filed", value: bond });
  if (address) fields.push({ label: "Address", value: compactAddress });

  if (fields.length === 0) return null;

  const fitParts = [
    type ? titleCase(type) : "",
    status ? `${status.toLowerCase()} authority` : "",
    /^yes/i.test(bond) ? "bond filed" : ""
  ].filter(Boolean);
  const fitReason = fitParts.length ? `${fitParts.join(", ")} — matches carrier-services ICP.` : "";

  return { fields, fitReason, state, location: address ? compactAddress : "" };
}
