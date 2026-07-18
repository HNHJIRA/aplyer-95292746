export interface ResumeMetadata {
  fileName: string;
  fileSize: number;
  fileType: string;
  uploadedAt: string;
}

export interface ResumeScore {
  score: number;
  strengths: string[];
  suggestions: string[];
  sections: {
    contact: boolean;
    experience: boolean;
    skills: boolean;
    education: boolean;
    summary: boolean;
    certifications: boolean;
  };
  completeness: number;
  readiness: number;
  strength: number;
}

export interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedin: string;
  portfolio: string;
  location: string;
}

export type WritingSampleType =
  | "cover_letter"
  | "linkedin_post"
  | "professional_email"
  | "blog"
  | "essay"
  | "free_text"
  | "career_summary"
  | "other";

export interface WritingSample {
  id: string;
  type: WritingSampleType;
  title: string;
  content: string;
  wordCount: number;
  createdAt: string;
}

export type SubscriptionTier = "free" | "pro" | "enterprise";
export interface SubscriptionStatus {
  tier: SubscriptionTier;
  renewsAt?: string;
}

export type AIProviderId = "claude" | "openai" | "gemini";
export interface Settings {
  aiProvider: AIProviderId;
  notifications: boolean;
  autofillEnabled: boolean;
  telemetry: boolean;
}

export type OnboardingStep =
  | "welcome"
  | "resume_upload"
  | "resume_analysis"
  | "writedna_progress"
  | "writing_samples"
  | "voice_card"
  | "profile"
  | "success"
  | "done";

export interface OnboardingStatus {
  completed: boolean;
  currentStep: OnboardingStep;
  startedAt?: string;
  completedAt?: string;
  skippedWritingSamples?: boolean;
}

export type WriteDnaStage = "idle" | "building" | "good" | "strong";
export type VoiceCardStatus =
  | "locked"
  | "collecting_samples"
  | "eligible"
  | "generating"
  | "generated"
  | "failed"
  | "stale"
  // Legacy — kept for backwards compat during rollout
  | "unlocking"
  | "unlocked";

export interface VoiceCardData {
  tone: string;
  cadence: string;
  formality: string;
  vocabulary_bias: string;
  distinctive_traits: string[];
  hooks_and_transitions: string[];
  values_signals: string[];
  do_and_avoid: { do: string[]; avoid: string[] };
  headline: string;
}

export interface WriteDnaState {
  stage: WriteDnaStage;
  voiceConfidence: number;
  resumeUploaded: boolean;
  writingSampleCount: number;
  qualifyingProseCount: number;
  resumeOnly: boolean;
  voiceCardStatus: VoiceCardStatus;
  voiceCard: VoiceCardData | null;
  voiceCardGeneratedAt: string | null;
  voiceCardError: string | null;
  celebratedStrong: boolean;
  abDemoCompleted: boolean;
  abDemoAnswer: string | null;
  fallbackChoiceCompleted: boolean;
  preferredVariantId: string | null;
}

export interface WritingSampleDraft {
  type: WritingSampleType;
  title: string;
  content: string;
  isOpen: boolean;
  updatedAt: string;
}

export interface AplyerState {
  activeUserId: string | null;
  resumeText: string | null;
  resumeMetadata: ResumeMetadata | null;
  resumeScore: ResumeScore | null;
  profile: Profile | null;
  writingSamples: WritingSample[];
  writingSampleDraft: WritingSampleDraft | null;
  subscriptionStatus: SubscriptionStatus;
  settings: Settings;
  onboardingStatus: OnboardingStatus;
  writeDna: WriteDnaState;
  lastUpdated: string | null;
}

export const DEFAULT_WRITEDNA: WriteDnaState = {
  stage: "idle",
  voiceConfidence: 0,
  resumeUploaded: false,
  writingSampleCount: 0,
  qualifyingProseCount: 0,
  resumeOnly: false,
  voiceCardStatus: "locked",
  voiceCard: null,
  voiceCardGeneratedAt: null,
  voiceCardError: null,
  celebratedStrong: false,
  abDemoCompleted: false,
  abDemoAnswer: null,
  fallbackChoiceCompleted: false,
  preferredVariantId: null,
};

export const DEFAULT_STATE: AplyerState = {
  activeUserId: null,
  resumeText: null,
  resumeMetadata: null,
  resumeScore: null,
  profile: null,
  writingSamples: [],
  writingSampleDraft: null,
  subscriptionStatus: { tier: "free" },
  settings: {
    aiProvider: "claude",
    notifications: true,
    autofillEnabled: true,
    telemetry: false,
  },
  onboardingStatus: { completed: false, currentStep: "welcome" },
  writeDna: DEFAULT_WRITEDNA,
  lastUpdated: null,
};
