import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, AlertCircle, Sparkles, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/extension-auth")({
  validateSearch: (search) => ({
    ext: typeof search.ext === "string" ? search.ext : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Connect extension · Aplyer.ai" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ExtensionAuthPage,
});

type Status = "loading" | "need_signin" | "sending" | "sent" | "error" | "no_ext";

function ExtensionAuthPage() {
  const { ext } = Route.useSearch();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ext) {
      setStatus("no_ext");
      return;
    }

    let cancelled = false;

    async function trySend(extensionId: string) {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      if (!s) {
        if (!cancelled) setStatus("need_signin");
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (window as any).chrome;
      if (!c?.runtime?.sendMessage) {
        if (!cancelled) {
          setError("Chrome runtime unavailable. Open this page in Chrome with the Aplyer extension installed.");
          setStatus("error");
        }
        return;
      }

      setStatus("sending");
      try { localStorage.setItem("aplyer.ext_id", extensionId); } catch { /* noop */ }
      const payload = {
        type: "APLYER_AUTH_SET",
        session: {
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: s.expires_at,
          user: { id: s.user.id, email: s.user.email },
        },
      };

      try {
        c.runtime.sendMessage(extensionId, payload, (res: { ok: boolean; error?: string } | undefined) => {
          if (cancelled) return;
          const lastErr = c.runtime.lastError?.message;
          if (lastErr) {
            setError(lastErr);
            setStatus("error");
            return;
          }
          if (res?.ok) setStatus("sent");
          else {
            setError(res?.error ?? "Extension did not acknowledge.");
            setStatus("error");
          }
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to reach the extension.");
          setStatus("error");
        }
      }
    }

    trySend(ext);

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" && ext) trySend(ext);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [ext]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Toaster />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-brand-green/15 blur-[140px]" />
      </div>

      <header className="flex items-center justify-between px-8 py-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-green text-[#06140A]">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-[15px] font-black tracking-tight">aplyer.ai</span>
        </Link>
      </header>

      <div className="mx-auto flex max-w-md flex-col px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl border border-border bg-card p-8"
        >
          <Body status={status} error={error} ext={ext} />
        </motion.div>
      </div>
    </div>
  );
}

function Body({ status, error, ext }: { status: Status; error: string | null; ext?: string }) {
  if (status === "no_ext") {
    return (
      <div>
        <AlertCircle className="h-6 w-6 text-brand-red" />
        <h1 className="mt-3 text-[22px] font-black tracking-tight">Missing extension ID</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Open this page from the Aplyer Chrome extension to connect your account.
        </p>
      </div>
    );
  }

  if (status === "loading" || status === "sending") {
    return (
      <div>
        <Loader2 className="h-6 w-6 animate-spin text-brand-green" />
        <h1 className="mt-3 text-[22px] font-black tracking-tight">
          {status === "loading" ? "Checking your session…" : "Connecting the extension…"}
        </h1>
      </div>
    );
  }

  if (status === "need_signin") {
    const redirect = `/extension-auth?ext=${encodeURIComponent(ext ?? "")}`;
    return (
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-green/25 bg-brand-green/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-brand-green">
          Sign in to continue
        </div>
        <h1 className="mt-3 text-[22px] font-black tracking-tight">Connect your extension</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Sign in to your Aplyer account so the extension can sync your resume and writing samples.
        </p>
        <Link
          to="/auth"
          search={{ redirect }}
          className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand-green px-5 text-[13px] font-semibold text-[#06140A] hover:bg-brand-green-2"
        >
          Sign in <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <div>
        <CheckCircle2 className="h-7 w-7 text-brand-green" />
        <h1 className="mt-3 text-[22px] font-black tracking-tight">Extension connected</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          You can close this tab and return to the Aplyer extension. Your session is now synced.
        </p>
        <Link
          to="/dashboard"
          className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-paper px-5 text-[13px] font-semibold hover:bg-field"
        >
          Open dashboard <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div>
      <AlertCircle className="h-6 w-6 text-brand-red" />
      <h1 className="mt-3 text-[22px] font-black tracking-tight">Couldn't reach the extension</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {error ??
          "Make sure the Aplyer extension is installed in this Chrome browser, then reopen the popup and try again."}
      </p>
    </div>
  );
}
