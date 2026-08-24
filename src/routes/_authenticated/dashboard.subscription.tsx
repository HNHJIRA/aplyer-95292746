import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard/subscription")({
  component: SubscriptionPage,
});

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    blurb: "Get started with the basics.",
    features: ["Unlimited resume uploads", "Local resume scoring", "Profile autofill", "1 writing sample"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$12",
    blurb: "For active job seekers.",
    features: ["Everything in Free", "AI answer generation", "Unlimited writing samples", "Voice matching", "Workday + Greenhouse + Lever autofill"],
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    blurb: "For career services and teams.",
    features: ["Everything in Pro", "Team workspaces", "SSO", "Custom integrations", "Priority support"],
  },
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
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-black tracking-tight">Subscription</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">You're on the <span className="text-brand-green">{tier}</span> plan.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const active = tier === p.id;
          return (
            <div
              key={p.id}
              className={`relative rounded-2xl border p-6 ${p.highlight ? "border-brand-green/40 bg-gradient-to-br from-brand-green/10 to-transparent" : "border-border bg-card"}`}
            >
              {p.highlight && (
                <span className="absolute -top-2.5 left-6 inline-flex items-center gap-1 rounded-full bg-brand-green px-2.5 py-0.5 text-[10px] font-bold text-[#06140A]">
                  <Sparkles className="h-2.5 w-2.5" /> Most popular
                </span>
              )}
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{p.name}</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[32px] font-black">{p.price}</span>
                {p.id !== "enterprise" && <span className="text-[12px] text-muted-foreground">/ month</span>}
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">{p.blurb}</p>
              <ul className="mt-4 space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-sub">
                    <Check className="h-3.5 w-3.5 flex-shrink-0 text-brand-green" /> <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                disabled
                className={`mt-5 inline-flex h-10 w-full items-center justify-center rounded-lg text-[12px] font-semibold ${active ? "bg-brand-green/15 text-brand-green" : "border border-border bg-paper text-muted-foreground"}`}
              >
                {active ? "Current plan" : "Coming soon"}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-muted-foreground">Billing powered by Stripe.</p>
    </div>
  );
}
