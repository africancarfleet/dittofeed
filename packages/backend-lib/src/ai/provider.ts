import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { LanguageModel } from "ai";
import { assertUnreachable } from "isomorphic-lib/src/typeAssertions";

export const LLM_PROVIDERS = ["google", "anthropic", "openai"] as const;

export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

// Provider-appropriate default models, used when no model is configured.
export const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  google: "gemini-2.5-flash",
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
};

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

export function isLlmProvider(value: string): value is LlmProviderName {
  return LLM_PROVIDERS.some((provider) => provider === value);
}

/**
 * Resolves a provider/api-key/model into a Vercel AI SDK {@link LanguageModel}.
 * Throws {@link LlmConfigError} when configuration is missing or invalid so
 * callers can surface an actionable message. The caller supplies the resolved
 * config (see getWorkspaceLlmConfig) so per-workspace overrides are honoured.
 */
export function getLanguageModel({
  provider,
  apiKey,
  model,
}: {
  provider: string;
  apiKey?: string;
  model?: string;
}): LanguageModel {
  if (!isLlmProvider(provider)) {
    throw new LlmConfigError(
      `Unsupported LLM provider "${provider}". Expected one of: ${LLM_PROVIDERS.join(", ")}.`,
    );
  }
  if (!apiKey) {
    throw new LlmConfigError(
      "No LLM API key is configured. Set one in Settings or via LLM_API_KEY.",
    );
  }

  const modelId = model ?? DEFAULT_MODELS[provider];

  switch (provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    default:
      return assertUnreachable(provider);
  }
}
