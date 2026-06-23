import type { WaterfallTemplate } from "@/lib/phase1/types";

export type WaterfallChoice = { templateId: string; rationale: string };

const LOCAL_HINTS = [
  "auto", "repair", "dealer", "restaurant", "retail", "shop", "store", "salon", "clinic",
  "dental", "medical", "contractor", "plumb", "hvac", "roofing", "gym", "fitness", "hotel",
  "real estate", "realtor", "local"
];

/**
 * Pick the best-fit waterfall template for a profile from the workspace's vetted
 * templates. Deterministic on purpose: it maps the ICP's signals to a campaign
 * type, so the flow always lands on a real, tested template — never a blank or
 * hallucinated waterfall. (The LLM stays where free-text judgment matters.)
 */
export function pickWaterfallTemplateForProfile(input: {
  industries?: string[];
  titles?: string[];
  segments?: string[];
  templates: WaterfallTemplate[];
}): WaterfallChoice {
  const { templates } = input;
  if (templates.length === 0) {
    return { templateId: "", rationale: "No waterfall templates are available in this workspace." };
  }

  const haystack = [...(input.industries ?? []), ...(input.titles ?? []), ...(input.segments ?? [])]
    .join(" ")
    .toLowerCase();
  const byType = (campaignType: string) => templates.find((template) => template.campaignType === campaignType);

  const local = LOCAL_HINTS.some((hint) => haystack.includes(hint));
  const linkedin = haystack.includes("linkedin") || haystack.includes("sales navigator");

  const localTemplate = byType("local_business");
  if (local && localTemplate) {
    return {
      templateId: localTemplate.id,
      rationale: "Local-business ICP — discover via Google Maps, scrape the site for an email, then validate phone."
    };
  }

  const linkedinTemplate = byType("linkedin_sales_navigator");
  if (linkedin && linkedinTemplate) {
    return {
      templateId: linkedinTemplate.id,
      rationale: "LinkedIn-sourced ICP — enrich from the profile, find and verify a work email, then phone."
    };
  }

  const emailFirst = byType("email_first_call_later");
  if (emailFirst) {
    return {
      templateId: emailFirst.id,
      rationale: "General B2B ICP — verify emails first, then fall back to phone for engaged leads."
    };
  }

  return { templateId: templates[0].id, rationale: `Defaulting to ${templates[0].name}.` };
}
