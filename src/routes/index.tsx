import { createFileRoute } from "@tanstack/react-router";
import { PopupApp } from "@/components/extension/PopupApp";
import { Download, Puzzle, ChevronRight, CheckCircle } from "lucide-react";

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

function downloadExtension() {
  fetch("/aplyer-extension.zip")
    .then((res) => {
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "aplyer-extension.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err) => alert(err.message));
}

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

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-10 px-6 py-10 lg:flex-row lg:items-start lg:justify-between lg:py-16">
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

          {/* Download CTA */}
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
            <button
              onClick={downloadExtension}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-5 py-3 text-sm font-bold text-[#06140A] transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <Download className="h-4 w-4" />
              Download Extension
            </button>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              420 × 650 · Tailwind · Framer Motion · TypeScript
            </span>
          </div>

          {/* Install Steps */}
          <div className="mt-8 rounded-xl border border-border bg-paper p-5 text-left">
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Puzzle className="h-4 w-4 text-brand-green" />
              How to install
            </h3>
            <ol className="mt-4 space-y-3">
              {[
                "Download the ZIP and unzip it to a folder.",
                "Open chrome://extensions in Chrome (or any Chromium browser).",
                "Enable Developer mode (toggle top-right).",
                'Click "Load unpacked" and select the unzipped folder.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-[13px] text-sub">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-[10px] font-bold text-brand-green">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle className="h-3.5 w-3.5 text-brand-green" />
              Works in Chrome, Edge, Brave, Arc, and Opera.
            </p>
          </div>
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
