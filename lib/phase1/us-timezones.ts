// Approximate local-time derivation for the Focus dossier (SDR Cockpit §36 /
// roadmap §8): map a US state to an IANA timezone, then format via Intl so DST is
// handled correctly. Best-effort — a state can span zones; this uses the dominant
// one. Returns null when the state is unknown so the UI can omit local time.

const STATE_TZ: Record<string, string> = {
  // Pacific
  ca: "America/Los_Angeles",
  wa: "America/Los_Angeles",
  or: "America/Los_Angeles",
  nv: "America/Los_Angeles",
  // Mountain
  co: "America/Denver",
  ut: "America/Denver",
  nm: "America/Denver",
  mt: "America/Denver",
  wy: "America/Denver",
  id: "America/Denver",
  az: "America/Phoenix", // no DST
  // Central
  tx: "America/Chicago",
  il: "America/Chicago",
  mo: "America/Chicago",
  mn: "America/Chicago",
  wi: "America/Chicago",
  ia: "America/Chicago",
  ks: "America/Chicago",
  ne: "America/Chicago",
  ok: "America/Chicago",
  ar: "America/Chicago",
  la: "America/Chicago",
  ms: "America/Chicago",
  al: "America/Chicago",
  tn: "America/Chicago",
  nd: "America/Chicago",
  sd: "America/Chicago",
  // Eastern
  ny: "America/New_York",
  fl: "America/New_York",
  ga: "America/New_York",
  nc: "America/New_York",
  sc: "America/New_York",
  va: "America/New_York",
  wv: "America/New_York",
  md: "America/New_York",
  de: "America/New_York",
  nj: "America/New_York",
  pa: "America/New_York",
  oh: "America/New_York",
  mi: "America/New_York",
  in: "America/New_York",
  ky: "America/New_York",
  ct: "America/New_York",
  ri: "America/New_York",
  ma: "America/New_York",
  vt: "America/New_York",
  nh: "America/New_York",
  me: "America/New_York",
  dc: "America/New_York",
  // Non-contiguous
  ak: "America/Anchorage",
  hi: "Pacific/Honolulu"
};

const NAME_TO_ABBR: Record<string, string> = {
  california: "ca",
  washington: "wa",
  oregon: "or",
  nevada: "nv",
  colorado: "co",
  utah: "ut",
  "new mexico": "nm",
  montana: "mt",
  wyoming: "wy",
  idaho: "id",
  arizona: "az",
  texas: "tx",
  illinois: "il",
  missouri: "mo",
  minnesota: "mn",
  wisconsin: "wi",
  iowa: "ia",
  kansas: "ks",
  nebraska: "ne",
  oklahoma: "ok",
  arkansas: "ar",
  louisiana: "la",
  mississippi: "ms",
  alabama: "al",
  tennessee: "tn",
  "north dakota": "nd",
  "south dakota": "sd",
  "new york": "ny",
  florida: "fl",
  georgia: "ga",
  "north carolina": "nc",
  "south carolina": "sc",
  virginia: "va",
  "west virginia": "wv",
  maryland: "md",
  delaware: "de",
  "new jersey": "nj",
  pennsylvania: "pa",
  ohio: "oh",
  michigan: "mi",
  indiana: "in",
  kentucky: "ky",
  connecticut: "ct",
  "rhode island": "ri",
  massachusetts: "ma",
  vermont: "vt",
  "new hampshire": "nh",
  maine: "me",
  alaska: "ak",
  hawaii: "hi"
};

function resolveTimezone(state: string): string | null {
  const trimmed = state.trim().toLowerCase();
  if (!trimmed) return null;
  if (STATE_TZ[trimmed]) return STATE_TZ[trimmed];
  const abbr = NAME_TO_ABBR[trimmed];
  return abbr ? STATE_TZ[abbr] : null;
}

/** The contact's local time + whether it's outside the 8:00–20:00 calling window. */
export function localTimeForState(state: string): { label: string; outsideWindow: boolean } | null {
  const tz = resolveTimezone(state);
  if (!tz) return null;
  try {
    const now = new Date();
    const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(now);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now)
    );
    const inWindow = Number.isFinite(hour) && hour >= 8 && hour < 20;
    return { label: `${label} local`, outsideWindow: !inWindow };
  } catch {
    return null;
  }
}
