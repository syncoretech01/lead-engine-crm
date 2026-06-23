import { generateJson, llmEnabled } from "@/lib/llm/openai-client";
import { validateIcpDraft, type IcpDraft } from "@/lib/llm/icp-schema";

export type IcpDraftSource = "llm" | "fallback";
export type IcpDraftResult = { draft: IcpDraft; source: IcpDraftSource };

const SYSTEM_PROMPT = [
  "You build an ICP (ideal customer profile) for a B2B outbound sales tool.",
  "Given a free-text description of a target audience, return ONLY a JSON object with these keys:",
  '{ "name": string, "description": string, "industries": string[], "titles": string[],',
  '  "geographies": string[], "technologies": string[], "segments": string[],',
  '  "fitSignals": string[], "confidence": number }.',
  "Rules: titles are buyer/decision-maker job titles; geographies are places; confidence is 0-100;",
  "keep each array to at most 6 concise items; do not invent a company or contact; no prose outside the JSON."
].join(" ");

/**
 * Resolve an ICP draft for a free-text prompt. Tries the model when enabled,
 * validates + sanitizes its output, and falls back to the deterministic parser
 * (passed in by the caller) on disabled, network error, or invalid output.
 * Never throws — the flow must always produce a usable draft.
 */
export async function resolveIcpDraft(prompt: string, fallback: () => IcpDraft): Promise<IcpDraftResult> {
  if (!llmEnabled()) {
    return { draft: fallback(), source: "fallback" };
  }

  try {
    const raw = await generateJson({ system: SYSTEM_PROMPT, user: `Build an ICP for: ${prompt}` });
    const validated = validateIcpDraft(raw);
    if (validated) {
      return { draft: validated, source: "llm" };
    }
  } catch {
    // Swallow and fall back — a model outage or bad payload must not break the flow.
  }

  return { draft: fallback(), source: "fallback" };
}
