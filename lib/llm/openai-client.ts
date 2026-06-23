import { fetchJson } from "@/lib/providers/adapters/http";

/**
 * Minimal OpenAI JSON client for advisory features (ICP drafting today). Like
 * the live-provider kill switch, it is disabled by default and only makes a real
 * call when SYNCORE_ENABLE_LLM=true and OPENAI_API_KEY is set. Everything else in
 * the app keeps working through deterministic fallbacks when this is off.
 */
type LlmEnv = {
  SYNCORE_ENABLE_LLM?: string;
  OPENAI_API_KEY?: string;
  SYNCORE_LLM_MODEL?: string;
  SYNCORE_LLM_BASE_URL?: string;
};

export function llmEnabled(env: LlmEnv = process.env as LlmEnv): boolean {
  return env.SYNCORE_ENABLE_LLM === "true" && Boolean(env.OPENAI_API_KEY);
}

function extractContent(json: Record<string, unknown>): string | null {
  const choices = json.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return typeof content === "string" ? content : null;
}

/**
 * Call the model in JSON mode and return the parsed object. Throws on disabled,
 * HTTP failure, empty content, or invalid JSON — callers are expected to catch
 * and fall back, so a model outage never breaks the flow.
 */
export async function generateJson(input: { system: string; user: string; env?: LlmEnv }): Promise<unknown> {
  const env = input.env ?? (process.env as LlmEnv);
  if (!llmEnabled(env)) {
    throw new Error("LLM is disabled. Set SYNCORE_ENABLE_LLM=true and OPENAI_API_KEY.");
  }

  const model = env.SYNCORE_LLM_MODEL || "gpt-4o-mini";
  const baseUrl = env.SYNCORE_LLM_BASE_URL || "https://api.openai.com/v1";

  const { ok, status, json } = await fetchJson(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user }
        ]
      })
    },
    20_000
  );

  if (!ok) {
    throw new Error(`LLM request failed with HTTP ${status}.`);
  }

  const content = extractContent(json);
  if (!content) {
    throw new Error("LLM returned no content.");
  }

  return JSON.parse(content) as unknown;
}
