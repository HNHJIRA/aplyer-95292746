import { createFileRoute } from "@tanstack/react-router";
import { PopupApp } from "@/components/extension/PopupApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aplyer.ai — Stop Skipping Jobs" },
      { name: "description", content: "Chrome extension that helps you apply faster and sound like yourself on every job application." },
      { property: "og:title", content: "Aplyer.ai — Stop Skipping Jobs" },
      { property: "og:description", content: "Upload your resume once and let Aplyer assist you across supported job applications." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-background">
      {/* Ambient grid */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 10%, rgba(29,185,84,0.08), transparent 40%), radial-gradient(circle at 80% 90%, rgba(229,55,58,0.06), transparent 40%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-8 px-6 py-10 lg:flex-row lg:items-start lg:justify-between lg:py-16">
        <section className="max-w-md text-center lg:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-green/25 bg-brand-green/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-brand-green">
            Milestone 1 · Foundation
          </div>
          <h1 className="mt-5 text-[36px] font-black leading-[1.05] tracking-tight md:text-[44px]">
            The Aplyer.ai <span className="text-brand-green">Chrome Extension</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-sub">
            Onboarding, resume scoring, profile and writing samples — wired to a real local storage
            architecture. Ready to drop into a Manifest V3 extension popup.
          </p>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            420 × 650 · Tailwind · Framer Motion · TypeScript
          </p>
        </section>

        {/* Browser-style frame */}
        <div className="relative">
          <div
            className="absolute -inset-6 -z-10 rounded-[40px] opacity-70 blur-2xl"
            style={{ background: "radial-gradient(50% 50% at 50% 30%, rgba(29,185,84,0.25), transparent 70%)" }}
          />
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-paper shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
            <div className="flex items-center gap-1.5 border-b border-border bg-[#0a1322] px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                aplyer · popup
              </span>
            </div>
            <div className="h-[650px] w-[420px] overflow-hidden bg-background">
              <PopupApp />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
