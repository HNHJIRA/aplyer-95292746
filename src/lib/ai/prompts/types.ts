// Canonical prompt-spec contract shared by every prompt module.
// Prompt modules are pure (no server imports) so they can be unit-tested.

export type PromptId =
  | "A_ANSWER_GENERATION"
  | "B_VOICE_CARD"
  | "C_RESUME_AUDIT"
  | "D_RESUME_SCORE"
  | "I_QUESTION_CLASSIFICATION"
  | "J_QUALITY_SCAN";

export interface PromptSpec {
  /** Stable identifier used in logs and telemetry. */
  id: PromptId;
  /** Bump whenever the prompt text or output contract changes. */
  version: string;
  /** Anthropic model id this prompt is canonically run against. */
  model: string;
  /** Max output tokens. */
  maxTokens: number;
  /** Sampling temperature. */
  temperature: number;
  /** Whether the model must return strict JSON. */
  json: boolean;
  /** System prompt text. */
  system: string;
}
