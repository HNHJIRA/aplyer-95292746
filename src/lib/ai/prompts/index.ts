export * from "./types";
export * from "./models";
export * from "./prompt-a-answer-generation";
export * from "./prompt-b-voice-card";
export * from "./prompt-c-resume-audit";
export * from "./prompt-d-resume-score";
export * from "./prompt-i-classification";
export * from "./prompt-p0-fact-inventory";
export * from "./prompt-j-quality-scan";

import { PROMPT_A_ANSWER_GENERATION } from "./prompt-a-answer-generation";
import { PROMPT_B_VOICE_CARD } from "./prompt-b-voice-card";
import { PROMPT_C_RESUME_AUDIT } from "./prompt-c-resume-audit";
import { PROMPT_D_RESUME_SCORE } from "./prompt-d-resume-score";
import { PROMPT_I_CLASSIFICATION } from "./prompt-i-classification";
import { PROMPT_P0_FACT_INVENTORY } from "./prompt-p0-fact-inventory";
import { PROMPT_J_QUALITY_SCAN } from "./prompt-j-quality-scan";
import type { PromptSpec } from "./types";

export const PROMPT_LIBRARY: PromptSpec[] = [
  PROMPT_A_ANSWER_GENERATION,
  PROMPT_B_VOICE_CARD,
  PROMPT_C_RESUME_AUDIT,
  PROMPT_D_RESUME_SCORE,
  PROMPT_I_CLASSIFICATION,
  PROMPT_J_QUALITY_SCAN,
  PROMPT_P0_FACT_INVENTORY,
];
