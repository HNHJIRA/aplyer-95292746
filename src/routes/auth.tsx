import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Mail, Lock, User as UserIcon, Phone, Sparkles } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in · Aplyer.ai" },
      { name: "description", content: "Sign in or create your Aplyer.ai account." },
    ],
  }),
  component: AuthPage,
});

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "At least 8 characters").max(72),
});

const signUpSchema = signInSchema.extend({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().min(1, "Required").max(80),
});

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const redirectTo = getSafeRedirect(search.redirect);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) goToRedirect(redirectTo, navigate);
    });
  }, [navigate, redirectTo]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signin") {
        const parsed = signInSchema.safeParse(form);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Check your inputs");
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        toast.success("Welcome back");
        goToRedirect(redirectTo, navigate);
      } else {
        const parsed = signUpSchema.safeParse(form);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Check your inputs");
          return;
        }
        const { error: signUpError } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: `${window.location.origin}${redirectTo}`,
            data: { first_name: parsed.data.firstName, last_name: parsed.data.lastName },
          },
        });
        if (signUpError) {
          toast.error(signUpError.message);
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (signInError) {
          toast.error(signInError.message);
          return;
        }
        toast.success("Welcome to Aplyer");
        goToRedirect(redirectTo, navigate);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Toaster />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-brand-green/15 blur-[140px]" />
        <div className="absolute bottom-0 right-0 h-[360px] w-[360px] rounded-full bg-brand-red/10 blur-[120px]" />
      </div>

      <header className="flex items-center justify-between px-8 py-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-green text-[#06140A]">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-[15px] font-black tracking-tight">aplyer.ai</span>
        </Link>
        <Link to="/" className="text-[12px] text-muted-foreground hover:text-foreground">← Back to home</Link>
      </header>

      <div className="mx-auto flex max-w-md flex-col px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl border border-border bg-card p-8 shadow-[0_30px_80px_-40px_rgba(29,185,84,0.4)]"
        >
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-brand-green/25 bg-brand-green/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-brand-green">
            {mode === "signin" ? "Sign in" : "Create account"}
          </div>
          <h1 className="mt-2 text-[26px] font-black tracking-tight">
            {mode === "signin" ? "Welcome back" : "Get started free"}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {mode === "signin"
              ? "Sign in to your Aplyer dashboard."
              : "Upload your resume once, apply faster everywhere."}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-paper px-3 py-2.5 text-[12px] text-muted-foreground"
            >
              Google · Soon
            </button>
            <button
              type="button"
              disabled
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-paper px-3 py-2.5 text-[12px] text-muted-foreground"
            >
              LinkedIn · Soon
            </button>
          </div>

          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or email <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <div className="grid grid-cols-2 gap-2">
                <Field
                  icon={<UserIcon className="h-4 w-4" />}
                  placeholder="First name"
                  value={form.firstName}
                  onChange={(v) => setForm({ ...form, firstName: v })}
                />
                <Field
                  placeholder="Last name"
                  value={form.lastName}
                  onChange={(v) => setForm({ ...form, lastName: v })}
                />
              </div>
            )}
            <Field
              icon={<Mail className="h-4 w-4" />}
              type="email"
              placeholder="you@work.com"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <Field
              icon={<Lock className="h-4 w-4" />}
              type="password"
              placeholder="Password (min 8 chars)"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
            />

            {mode === "signin" && (
              <div className="flex justify-end">
                <Link
                  to="/auth/forgot"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Forgot password?
                </Link>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-green text-[13px] font-semibold text-[#06140A] shadow-[0_10px_30px_-12px_rgba(29,185,84,0.7)] transition-all hover:bg-brand-green-2 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "signin" ? "Sign in" : "Create account"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-5 text-center text-[12px] text-muted-foreground">
            {mode === "signin" ? "New to Aplyer?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-semibold text-brand-green hover:underline"
            >
              {mode === "signin" ? "Create account" : "Sign in"}
            </button>
          </p>
        </motion.div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          By continuing you agree to Aplyer's Terms and Privacy.
        </p>
      </div>
    </div>
  );
}

function getSafeRedirect(redirect?: string) {
  if (redirect === "/extension-auth" || redirect?.startsWith("/extension-auth?")) return redirect;
  if (redirect === "/dashboard" || redirect?.startsWith("/dashboard/")) return redirect;
  return "/dashboard";
}

function goToRedirect(redirectTo: string, navigate: ReturnType<typeof useNavigate>) {
  if (redirectTo.startsWith("/extension-auth")) {
    window.location.href = redirectTo;
    return;
  }
  navigate({ to: redirectTo as "/dashboard" });
}

function Field({
  icon,
  type = "text",
  placeholder,
  value,
  onChange,
}: {
  icon?: React.ReactNode;
  type?: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="group relative flex h-11 items-center rounded-lg border border-border bg-paper transition-colors focus-within:border-brand-green/60">
      {icon ? (
        <span className="pl-3 text-muted-foreground group-focus-within:text-brand-green">{icon}</span>
      ) : null}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-full bg-transparent px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
    </label>
  );
}
