/**
 * Contract for an LLM-drafted ICP. It mirrors exactly what the deterministic
 * `parsePromptForIcp` (lib/phase1/ai.ts) already produces, so the rest of the
 * pipeline — createIcpRecommendationFromPrompt -> applyAiIcpRecommendation -> a
 * real SearchProfile — is unchanged whether the draft came from the model or
 * the keyword fallback.
 */
export type IcpDraft = {
  name: string;
  description: string;
  industries: string[];
  titles: string[];
  geographies: string[];
  technologies: string[];
  segments: string[];
  fitSignals: string[];
  confidence: number;
};

const MAX_ITEMS = 8;
const MAX_LABEL = 80;

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, MAX_LABEL);
    if (trimmed) out.push(trimmed);
  }
  return Array.from(new Set(out)).slice(0, MAX_ITEMS);
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

/**
 * Validate + sanitize raw LLM JSON into an `IcpDraft`. Returns `null` when the
 * payload is missing the essentials (a name plus at least one targeting signal),
 * so the caller can fall back to the deterministic parser. The model's shape is
 * never trusted: arrays are filtered to strings, capped, de-duped, and confidence
 * is clamped.
 */
export function validateIcpDraft(raw: unknown): IcpDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  const name = cleanString(data.name, MAX_LABEL);
  const industries = cleanStringArray(data.industries);
  const titles = cleanStringArray(data.titles);
  // An ICP is only useful with a name plus at least one of industries/titles.
  if (!name || (industries.length === 0 && titles.length === 0)) return null;

  const geographies = cleanStringArray(data.geographies);
  const segments = cleanStringArray(data.segments);
  const fitSignals = cleanStringArray(data.fitSignals);
  const confidenceRaw = typeof data.confidence === "number" ? data.confidence : 70;

  return {
    name,
    description: cleanString(data.description, 240) ?? `AI-drafted ICP: ${name}`,
    industries,
    titles,
    geographies: geographies.length ? geographies : ["United States"],
    technologies: cleanStringArray(data.technologies),
    segments: segments.length ? segments : ["AI recommended ICP"],
    fitSignals: fitSignals.length
      ? fitSignals
      : ["Matches the described target", "Can be verified before outreach", "Compatible with suppression + export gates"],
    confidence: Math.max(40, Math.min(95, Math.round(confidenceRaw)))
  };
}
