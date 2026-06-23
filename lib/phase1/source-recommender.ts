/**
 * Recommend lead sources for an ICP. Deterministic on purpose: the source set is
 * small and the mapping is clear, so rules beat an LLM here — no tokens, no
 * latency, no hallucination. The LLM stays where free-text judgment matters
 * (drafting the ICP itself).
 */
export const leadSourceOptions: string[] = ["Apollo", "Hunter", "Google Places", "Apify", "CSV Upload"];

export type SourceRecommendation = { sources: string[]; rationale: string };

const LOCAL_BUSINESS_HINTS = [
  "auto", "repair", "dealer", "restaurant", "cafe", "bakery", "retail", "shop", "store",
  "salon", "spa", "clinic", "dental", "medical", "contractor", "plumb", "hvac", "roofing",
  "landscap", "construction", "gym", "fitness", "hotel", "real estate", "realtor", "local"
];

const B2B_TECH_HINTS = [
  "software", "saas", "fintech", "cloud", "platform", "cyber", "marketing", "agency",
  "b2b", "startup", "ecommerce", "e-commerce", "logistics", "consult", "technology"
];

/**
 * Pick a ranked source set + a one-line rationale from an ICP's signals. Local
 * businesses lean on geography discovery (Google Places / Apify); B2B/tech leans
 * on contact databases (Apollo / Hunter); everything else gets a general mix.
 */
export function recommendSourcesForIcp(input: {
  industries?: string[];
  titles?: string[];
  segments?: string[];
}): SourceRecommendation {
  const haystack = [...(input.industries ?? []), ...(input.titles ?? []), ...(input.segments ?? [])]
    .join(" ")
    .toLowerCase();
  const looksLocal = LOCAL_BUSINESS_HINTS.some((hint) => haystack.includes(hint));
  const looksTech = B2B_TECH_HINTS.some((hint) => haystack.includes(hint));

  if (looksLocal) {
    return {
      sources: ["Google Places", "Apify", "Apollo"],
      rationale: "Local-business ICP — Google Places and Apify discover companies by geography; Apollo fills in contacts."
    };
  }

  if (looksTech) {
    return {
      sources: ["Apollo", "Hunter"],
      rationale: "B2B / technology ICP — Apollo sources contacts by title and industry; Hunter finds and verifies work emails."
    };
  }

  return {
    sources: ["Apollo", "Hunter", "Google Places"],
    rationale: "General B2B ICP — Apollo and Hunter for contacts and emails, with Google Places as a local fallback."
  };
}
