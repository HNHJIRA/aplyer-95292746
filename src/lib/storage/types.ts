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
  | "professional_email"
  | "personal_bio"
  | "career_summary";

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
  | "profile"
  | "writing_samples"
  | "success"
  | "done";

export interface OnboardingStatus {
  completed: boolean;
  currentStep: OnboardingStep;
  startedAt?: string;
  completedAt?: string;
  skippedWritingSamples?: boolean;
}

export interface AplyerState {
  resumeText: string | null;
  resumeMetadata: ResumeMetadata | null;
  resumeScore: ResumeScore | null;
  profile: Profile | null;
  writingSamples: WritingSample[];
  subscriptionStatus: SubscriptionStatus;
  settings: Settings;
  onboardingStatus: OnboardingStatus;
  lastUpdated: string | null;
}

export const DEFAULT_STATE: AplyerState = {
  resumeText: null,
  resumeMetadata: null,
  resumeScore: null,
  profile: null,
  writingSamples: [],
  subscriptionStatus: { tier: "free" },
  settings: {
    aiProvider: "claude",
    notifications: true,
    autofillEnabled: true,
    telemetry: false,
  },
  onboardingStatus: { completed: false, currentStep: "welcome" },
  lastUpdated: null,
};
