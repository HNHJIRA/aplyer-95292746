import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { LogoMark } from "@/components/extension/Logo";

export const Route = createFileRoute("/auth/forgot")({
  head: () => ({
    meta: [{ title: "Reset password · Aplyer.ai" }],
  }),
  component: ForgotPage,
});

function ForgotPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().trim().email().max(255).safeParse(email);
    if (!parsed.success) {
      toast.error("Enter a valid email");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
    toast.success("Check your email for the reset link.");
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Toaster />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-brand-green/15 blur-[140px]" />
      </div>
      <header className="flex items-center justify-between px-8 py-6">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark size={30} />
          <span className="text-[15px] font-black tracking-tight">aplyer.ai</span>
        </Link>
      </header>

      <div className="mx-auto flex max-w-md flex-col px-6 py-8">
        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="text-[24px] font-black tracking-tight">Reset your password</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Enter the email you signed up with. We'll send you a secure link.
          </p>

          {sent ? (
            <div className="mt-6 rounded-lg border border-brand-green/30 bg-brand-green/10 p-4 text-[13px] text-brand-green">
              Link sent. Check your inbox.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-3">
              <label className="flex h-11 items-center rounded-lg border border-border bg-paper">
                <span className="pl-3 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@work.com"
                  className="h-full w-full bg-transparent px-3 text-[13px] focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-green text-[13px] font-semibold text-[#06140A] hover:bg-brand-green-2 disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send reset link
              </button>
            </form>
          )}

          <Link
            to="/auth"
            className="mt-6 inline-flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
