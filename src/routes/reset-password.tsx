import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set new password · Aplyer.ai" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase auto-handles the recovery token in the hash and emits PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Toaster />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-brand-green/15 blur-[140px]" />
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
        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="text-[24px] font-black tracking-tight">Set a new password</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {ready ? "Choose a strong password you haven't used before." : "Verifying your reset link…"}
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <PField value={password} onChange={setPassword} placeholder="New password" />
            <PField value={confirm} onChange={setConfirm} placeholder="Confirm password" />
            <button
              type="submit"
              disabled={loading || !ready}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-green text-[13px] font-semibold text-[#06140A] hover:bg-brand-green-2 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Update password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function PField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex h-11 items-center rounded-lg border border-border bg-paper">
      <span className="pl-3 text-muted-foreground">
        <Lock className="h-4 w-4" />
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-full w-full bg-transparent px-3 text-[13px] focus:outline-none"
      />
    </label>
  );
}
