import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  APP_WEB_URL,
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
import { Welcome } from "./screens/Welcome";
import { ResumeUpload } from "./screens/ResumeUpload";
import { ResumeAnalysis } from "./screens/ResumeAnalysis";
import { Profile } from "./screens/Profile";
import { WritingSamples } from "./screens/WritingSamples";
import { Success } from "./screens/Success";
import { Dashboard } from "./screens/Dashboard";

const FLOW: OnboardingStep[] = [
  "welcome",
  "resume_upload",
  "resume_analysis",
  "profile",
  "writing_samples",
  "success",
  "done",
];

export function PopupApp() {
  const inExtension = isExtensionRuntime();
  const [session, setSession] = useState<ExtensionSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(!inExtension);
  const [checking, setChecking] = useState(false);
  const { state, loaded, update, reload } = useAplyerStore();

  const hydrateOnce = useCallback(async () => {
    try {
      await hydrateFromBackend();
      await reload();
    } catch (e) {
      console.warn("[aplyer] hydrate failed", e);
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

  void handleSignOut;
  async function handleSignOut() {
    if (inExtension) await signOutExtension();
    await supabase.auth.signOut();
    setSession(null);
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

  if (!sessionChecked || (session && !loaded)) {
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

  const step = state.onboardingStatus.completed ? "done" : state.onboardingStatus.currentStep;

  switch (step) {
    case "welcome":
      return <Welcome onNext={next("welcome")} />;
    case "resume_upload":
      return <ResumeUpload onNext={next("resume_upload")} onBack={back("resume_upload")} />;
    case "resume_analysis":
      return <ResumeAnalysis onNext={next("resume_analysis")} onBack={back("resume_analysis")} />;
    case "profile":
      return <Profile onNext={next("profile")} onBack={back("profile")} />;
    case "writing_samples":
      return <WritingSamples onNext={next("writing_samples")} onBack={back("writing_samples")} />;
    case "success":
      return <Success onDone={() => goTo("done")} />;
    case "done":
    default:
      return (
        <Dashboard
          onResume={() => { void goTo("resume_upload"); }}
          onProfile={() => { void goTo("profile"); }}
        />
      );
  }
}
