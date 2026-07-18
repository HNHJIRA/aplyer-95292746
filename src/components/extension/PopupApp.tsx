import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  APP_WEB_URL,
  clearExtensionLocal,
  getExtensionSession,
  isExtensionRuntime,
  openAuthInTab,
  signOutExtension,
  type ExtensionSession,
} from "@/lib/extension/runtime";
import { ensureSupabaseSession, hydrateFromBackend } from "@/lib/extension/sync";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";
import type { OnboardingStep } from "@/lib/storage/types";
import { SignIn } from "./screens/SignIn";
import { Settings } from "./screens/Settings";

import { Welcome } from "./screens/Welcome";
import { ResumeUpload } from "./screens/ResumeUpload";
import { ResumeAnalysis } from "./screens/ResumeAnalysis";

import { WritingSamples } from "./screens/WritingSamples";
import { WriteDnaProgress } from "./screens/WriteDnaProgress";
import { VoiceCard } from "./screens/VoiceCard";
import { AbDemo } from "./screens/AbDemo";
import { Success } from "./screens/Success";
import { Dashboard } from "./screens/Dashboard";

const FLOW: OnboardingStep[] = [
  "welcome",
  "resume_upload",
  "resume_analysis",
  "writedna_progress",
  "writing_samples",
  "voice_card",
  "success",
  "done",
];

export function PopupApp() {
  const inExtension = isExtensionRuntime();
  const [session, setSession] = useState<ExtensionSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(!inExtension);
  const [checking, setChecking] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { state, loaded, update, reload, reset } = useAplyerStore();

  // Derive A/B demo visibility from canonical server state, not a local flag.
  const showAbDemo =
    state.writeDna.voiceCardStatus === "generated" &&
    !state.writeDna.resumeOnly &&
    !state.writeDna.abDemoCompleted;

  const hydrateOnce = useCallback(async () => {
    setHydrating(true);
    try {
      await hydrateFromBackend();
      await reload();
    } catch (e) {
      console.warn("[aplyer] hydrate failed", e);
    } finally {
      setHydrating(false);
    }
  }, [reload]);

  const refreshSession = useCallback(async () => {
    if (!inExtension) {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          user: { id: data.session.user.id, email: data.session.user.email },
        });
        await hydrateOnce();
      } else {
        setSession(null);
      }
      setSessionChecked(true);
      return;
    }
    setChecking(true);
    try {
      const s = await getExtensionSession();
      setSession(s);
      const ok = await ensureSupabaseSession(s);
      if (ok) await hydrateOnce();
    } finally {
      setChecking(false);
      setSessionChecked(true);
    }
  }, [inExtension, hydrateOnce]);

  useEffect(() => {
    refreshSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (globalThis as any).chrome;
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && "aplyer.session.v1" in changes) {
        const next = changes["aplyer.session.v1"].newValue as ExtensionSession | undefined;
        setSession(next ?? null);
        (async () => {
          const ok = await ensureSupabaseSession(next ?? null);
          if (ok) await hydrateOnce();
        })();
      }
    };
    c?.storage?.onChanged?.addListener(onChanged);
    return () => c?.storage?.onChanged?.removeListener(onChanged);
  }, [refreshSession, hydrateOnce]);

  // Recovery: snap the current onboarding step to voice_card whenever the
  // canonical Voice Card status is mid-lifecycle (generating/failed/stale) or
  // generated-but-A/B-pending. This overrides local navigation history so a
  // returning user always lands on the correct screen.
  useEffect(() => {
    if (!loaded || !session || state.onboardingStatus.completed) return;
    const s = state.writeDna.voiceCardStatus;
    const mid = s === "generating" || s === "failed" || s === "stale";
    const abPending =
      s === "generated" &&
      !state.writeDna.resumeOnly &&
      !state.writeDna.abDemoCompleted;
    if ((mid || abPending) && state.onboardingStatus.currentStep !== "voice_card") {
      void update({
        onboardingStatus: { ...state.onboardingStatus, currentStep: "voice_card" },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, session, state.writeDna.voiceCardStatus, state.writeDna.abDemoCompleted, state.writeDna.resumeOnly]);

  async function handleSignOut() {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (e) {
      console.warn("[aplyer] supabase signOut failed", e);
    }
    try {
      if (inExtension) await signOutExtension();
      await clearExtensionLocal();
    } catch (e) {
      console.warn("[aplyer] clear extension state failed", e);
    }
    await reset();
    setShowSettings(false);
    setSession(null);
    setSessionChecked(true);
  }


  async function goTo(step: OnboardingStep) {
    await update({
      onboardingStatus: {
        ...state.onboardingStatus,
        currentStep: step,
        completed: step === "done",
        startedAt: state.onboardingStatus.startedAt ?? new Date().toISOString(),
        completedAt: step === "done" ? new Date().toISOString() : state.onboardingStatus.completedAt,
      },
    });
  }

  function next(from: OnboardingStep) {
    const i = FLOW.indexOf(from);
    return () => goTo(FLOW[Math.min(i + 1, FLOW.length - 1)]);
  }
  function back(from: OnboardingStep) {
    const i = FLOW.indexOf(from);
    return () => goTo(FLOW[Math.max(i - 1, 0)]);
  }

  if (!sessionChecked || (session && !loaded) || hydrating) {
    return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  }

  if (!session) {
    return (
      <SignIn
        onSignIn={() => (inExtension ? openAuthInTab(APP_WEB_URL) : (window.location.href = "/auth"))}
        onRefresh={refreshSession}
        checking={checking}
      />
    );
  }

  if (showSettings) {
    return <Settings onBack={() => setShowSettings(false)} onLogout={handleSignOut} />;
  }

  const step = state.onboardingStatus.completed ? "done" : state.onboardingStatus.currentStep;

  switch (step) {
    case "welcome":
      return <Welcome onNext={next("welcome")} />;
    case "resume_upload":
      return <ResumeUpload onNext={next("resume_upload")} onBack={back("resume_upload")} />;
    case "resume_analysis":
      return <ResumeAnalysis onNext={next("resume_analysis")} onBack={back("resume_analysis")} />;
    case "writedna_progress":
      return (
        <WriteDnaProgress
          onNext={() => goTo(state.writeDna.resumeOnly ? "success" : "voice_card")}
          onBack={back("writedna_progress")}
          onAddSample={() => goTo("writing_samples")}
          onCelebrate={() => goTo("voice_card")}
        />
      );
    case "writing_samples":
      return <WritingSamples onNext={() => goTo("writedna_progress")} onBack={() => goTo("writedna_progress")} />;
    case "voice_card":
      if (showAbDemo && state.writeDna.voiceCardStatus === "generated") {
        return <AbDemo onDone={() => { void hydrateOnce().then(() => goTo("success")); }} />;
      }
      return (
        <VoiceCard
          onDone={() => {
            // Refetch canonical state; PopupApp will re-route to A/B or success.
            void hydrateOnce().then(() => {
              if (state.writeDna.resumeOnly) void goTo("success");
              // else: showAbDemo will flip true on next render and render AbDemo.
            });
          }}
          onSkipToProfile={() => void goTo("success")}
        />
      );
    case "profile":
      // Profile step retired — sign-up already collects basic info.
      // Route legacy state straight to success/dashboard.
      return <Success onDone={() => goTo("done")} />;
    case "success":
      return <Success onDone={() => goTo("done")} />;
    case "done":
    default:
      return (
        <Dashboard
          onResume={() => { void goTo("resume_upload"); }}
          onProfile={() => { void goTo("done"); }}
          onSettings={() => setShowSettings(true)}
        />
      );
  }
}

