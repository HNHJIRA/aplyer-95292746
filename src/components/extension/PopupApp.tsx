import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";
import type { OnboardingStep } from "@/lib/storage/types";
import { Welcome } from "./screens/Welcome";
import { ResumeUpload } from "./screens/ResumeUpload";
import { ResumeAnalysis } from "./screens/ResumeAnalysis";
import { Profile } from "./screens/Profile";
import { WritingSamples } from "./screens/WritingSamples";
import { Success } from "./screens/Success";
import { Dashboard } from "./screens/Dashboard";

import { SignIn } from "./screens/SignIn";
import { StepDots } from "./ui/StepDots";
import {
  APP_WEB_URL,
  getExtensionSession,
  isExtensionRuntime,
  openAuthInTab,
  type ExtensionSession,
} from "@/lib/extension/runtime";

type View = OnboardingStep | "dashboard";

const ONBOARDING_ORDER: OnboardingStep[] = [
  "welcome",
  "resume_upload",
  "resume_analysis",
  "profile",
  "writing_samples",
  "success",
];

export function PopupApp({ onStart, onFinish }: { onStart?: () => void; onFinish?: () => void } = {}) {
  const { state, loaded, update } = useAplyerStore();
  const [view, setView] = useState<View>("welcome");
  const inExtension = isExtensionRuntime();
  const [session, setSession] = useState<ExtensionSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(!inExtension);
  const [checking, setChecking] = useState(false);

  const refreshSession = useCallback(async () => {
    if (!inExtension) return;
    setChecking(true);
    try {
      const s = await getExtensionSession();
      setSession(s);
    } finally {
      setChecking(false);
      setSessionChecked(true);
    }
  }, [inExtension]);

  useEffect(() => {
    if (!inExtension) return;
    refreshSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (globalThis as any).chrome;
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && "aplyer.session.v1" in changes) {
        const next = changes["aplyer.session.v1"].newValue as ExtensionSession | undefined;
        setSession(next ?? null);
      }
    };
    c?.storage?.onChanged?.addListener(onChanged);
    return () => c?.storage?.onChanged?.removeListener(onChanged);
  }, [inExtension, refreshSession]);

  useEffect(() => {
    if (!loaded) return;
    if (state.onboardingStatus.completed) {
      if (onFinish) { onFinish(); return; }
      setView("dashboard");
    } else {
      setView(state.onboardingStatus.currentStep === "done" ? "dashboard" : state.onboardingStatus.currentStep);
    }
  }, [loaded, state.onboardingStatus.completed, state.onboardingStatus.currentStep, onFinish]);

  const stepIndex = useMemo(() => {
    if (view === "dashboard" || view === "done") return -1;
    return ONBOARDING_ORDER.indexOf(view);
  }, [view]);

  async function goTo(next: View, currentStep?: OnboardingStep) {
    if (currentStep) await update({ onboardingStatus: { ...state.onboardingStatus, currentStep } });
    setView(next);
  }

  async function finishOnboarding() {
    await update({
      onboardingStatus: {
        ...state.onboardingStatus,
        completed: true,
        currentStep: "done",
        completedAt: new Date().toISOString(),
      },
    });
    if (onFinish) { onFinish(); return; }
    setView("dashboard");
  }

  if (!loaded || !sessionChecked) {
    return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  }

  if (inExtension && !session) {
    return (
      <SignIn
        onSignIn={() => openAuthInTab(APP_WEB_URL)}
        onRefresh={refreshSession}
        checking={checking}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {stepIndex >= 1 && stepIndex <= 4 && (
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Step {stepIndex} / 5
          </span>
          <StepDots total={5} current={stepIndex - 1} />
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute inset-0 flex flex-col"
          >
            {view === "welcome" && <Welcome onNext={onStart ?? (() => goTo("resume_upload", "resume_upload"))} />}
            {view === "resume_upload" && (
              <ResumeUpload
                onBack={() => goTo("welcome", "welcome")}
                onNext={() => goTo("resume_analysis", "resume_analysis")}
              />
            )}
            {view === "resume_analysis" && (
              <ResumeAnalysis
                onBack={() => goTo("resume_upload", "resume_upload")}
                onNext={() => goTo("profile", "profile")}
              />
            )}
            {view === "profile" && (
              <Profile
                onBack={() => goTo("resume_analysis", "resume_analysis")}
                onNext={() => goTo("writing_samples", "writing_samples")}
              />
            )}
            {view === "writing_samples" && (
              <WritingSamples
                onBack={() => goTo("profile", "profile")}
                onNext={() => goTo("success", "success")}
              />
            )}
            {view === "success" && <Success onDone={finishOnboarding} />}
            {view === "dashboard" && (
              <Dashboard
                onSettings={() => setView("settings")}
                onResume={() => setView("resume_upload")}
                onProfile={() => setView("profile")}
              />
            )}
            {view === "settings" && <Settings onBack={() => setView("dashboard")} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
