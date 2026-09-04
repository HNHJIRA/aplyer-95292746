import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Sparkles, FileText, Wand2, PenLine, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard/subscription")({
  component: SubscriptionPage,
});

/**
 * Plans describe only functionality that exists in the product today.
 * Pricing source of truth: Pro is $29 / month. No billing logic here — the
 * plan buttons are presentational and Stripe is untouched.
 */
const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    suffix: "/ month",
    blurb: "Set up your profile and see how Aplyer writes.",
    features: [
      "Resume upload and version history",
      "Resume Score with strengths and suggestions",
      "Write DNA setup and writing samples",
      "Chrome extension with job page detection",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    suffix: "/ month",
    blurb: "For people applying to jobs every week.",
    features: [
      "Everything in Free",
      "AI answer generation grounded in your resume",
      "Voice Card so answers sound like you",
      "Autofill and Autofill All on supported job sites",
      "Smart field intelligence and saved answers",
    ],
    highlight: true,
  },
];

const CAPABILITIES = [
  { icon: Wand2, title: "Answers from your own experience", body: "Every answer is written from the facts in your resume — never invented experience." },
  { icon: Zap, title: "Autofill and Autofill All", body: "Aplyer fills the standard application details it already knows and asks you about anything new." },
  { icon: FileText, title: "Resume Score", body: "See which sections your resume covers and what to improve, scored on your device." },
  { icon: PenLine, title: "Write DNA and Voice Card", body: "Your resume plus two qualifying writing samples teach Aplyer how you write." },
];

function SubscriptionPage() {
  const { data } = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data } = await supabase.from("subscriptions").select("*").eq("user_id", u.user!.id).maybeSingle();
      return data;
    },
  });
  const tier = data?.tier ?? "free";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-black tracking-tight">Subscription</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            You're on the <span className="font-semibold text-brand-green">{tier}</span> plan.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-paper px-4 py-2.5 text-[13px] text-muted-foreground">
          Aplyer Pro is <span className="font-semibold text-foreground">$29 / month</span>. Billing is handled by Stripe.
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {PLANS.map((p) => {
          const active = tier === p.id;
          return (
            <div
              key={p.id}
              className={`relative flex flex-col rounded-2xl border p-5 ${p.highlight ? "border-brand-green/40 bg-gradient-to-br from-brand-green/10 to-transparent" : "border-border bg-card"}`}
            >
              {p.highlight && (
                <span className="absolute -top-2.5 left-6 inline-flex items-center gap-1 rounded-full bg-brand-green px-2.5 py-0.5 text-[12px] font-bold text-[#06140A]">
                  <Sparkles className="h-2.5 w-2.5" /> Most popular
                </span>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">{p.name}</span>
                {active && (
                  <span className="rounded-full bg-brand-green/15 px-2.5 py-0.5 text-[12px] font-semibold text-brand-green">Your plan</span>
                )}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-[32px] font-black">{p.price}</span>
                <span className="text-[14px] text-muted-foreground">{p.suffix}</span>
              </div>
              <p className="mt-1 text-[14px] text-muted-foreground">{p.blurb}</p>
              <ul className="mt-3 grid flex-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[15px] text-sub">
                    <Check className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-brand-green" /> <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                disabled
                className={`mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg text-[14px] font-semibold ${active ? "bg-brand-green/15 text-brand-green" : "border border-border bg-paper text-muted-foreground"}`}
              >
                {active ? "Current plan" : "Coming soon"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">What Aplyer does</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="rounded-xl border border-border bg-paper p-4">
              <c.icon className="h-4 w-4 text-brand-green" />
              <div className="mt-2 text-[15px] font-bold leading-snug">{c.title}</div>
              <p className="mt-1 text-[13px] text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
