// Canonical Anthropic model ids used by the Aplyer prompt library.
//
// COMPLIANCE: the locked SOP pins each prompt to one model. There is NO
// fallback chain. If the required model is unavailable to the configured API
// key, the feature fails closed with a controlled provider error rather than
// generating with an unapproved model. Adding a fallback here requires an
// explicit written approval to change the SOP.
export const MODEL_OPUS = "claude-opus-4-6";
export const MODEL_HAIKU = "claude-haiku-4-5";

/** Models the SOP approves. Anything else must never reach the provider. */
export const APPROVED_MODELS: readonly string[] = [MODEL_OPUS, MODEL_HAIKU];

export function isApprovedModel(model: string): boolean {
  return APPROVED_MODELS.includes(model);
}
