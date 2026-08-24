// Canonical Anthropic model ids used by the Aplyer prompt library.
export const MODEL_OPUS = "claude-opus-4-6";
export const MODEL_HAIKU = "claude-haiku-4-5";

/**
 * Fallback chain used when a canonical model id is not available to the
 * configured API key (Anthropic answers 404 `model_not_found`). Keeps the
 * product working while the account is enabled for the newer model.
 */
export const MODEL_FALLBACKS: Record<string, string[]> = {
  [MODEL_OPUS]: ["claude-sonnet-4-5"],
  [MODEL_HAIKU]: ["claude-3-5-haiku-latest", "claude-sonnet-4-5"],
};
