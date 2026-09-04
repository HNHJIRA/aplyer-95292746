import { createFileRoute, Link } from "@tanstack/react-router";
import { PopupApp } from "@/components/extension/PopupApp";
import {
  Download,
  ChevronRight,
  Sparkles,
  ArrowRight,
  Check,
  X,
  Upload,
  Wand2,
  Send,
  Briefcase,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { downloadExtension } from "@/lib/download-extension";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aplyer.ai — Stop Skipping Jobs" },
      {
        name: "description",
        content:
          "Aplyer is a Chrome extension that fills job application essay questions in your own voice using your resume. Works on Workday, Greenhouse, Lever and any careers page.",
      },
      { property: "og:title", content: "Aplyer.ai — Stop Skipping Jobs" },
      {
        property: "og:description",
        content:
          "Apply faster and sound like yourself on every job application.",
      },
    ],
  }),
  component: Index,
});

import type { Variants } from "framer-motion";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

function Section({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <motion.section
      id={id}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      variants={stagger}
      className={className}
    >
      {children}
    </motion.section>
  );
}

function Index() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <AmbientBackground />
      <Nav />
      <Hero />
      <CompareSection />
      <HowItWorks />
      <StatsRow />
      <FinalCTA />
      <Footer />
    </main>
  );
}

/* ─────────────── Ambient background ─────────────── */
function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 20% 10%, rgba(29,185,84,0.12), transparent 60%), radial-gradient(50% 50% at 85% 90%, rgba(229,55,58,0.10), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 75%)",
        }}
      />
    </div>
  );
}

/* ─────────────── Nav ─────────────── */
function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#" className="flex items-center gap-2.5">
          <LogoMark />
          <div className="flex flex-col leading-none">
            <span className="text-[20px] font-black tracking-tight text-brand-green">
              Aplyer.ai
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
              Stop Skipping Jobs
            </span>
          </div>
        </a>
        <div className="flex items-center gap-2">
          <a
            href="#how"
            className="hidden rounded-md px-3 py-2 text-sm text-sub hover:text-foreground sm:block"
          >
            How it works
          </a>
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-primary-foreground shadow-[0_8px_24px_-8px_rgba(29,185,84,0.7)] transition-transform hover:scale-[1.03]"
          >
            Open Dashboard
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </nav>
  );
}

function LogoMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 88 88" fill="none">
      <defs>
        <linearGradient id="navG" x1="0" y1="44" x2="88" y2="44">
          <stop offset="0%" stopColor="#E5373A" />
          <stop offset="50%" stopColor="#E5373A" />
          <stop offset="50%" stopColor="#1DB954" />
          <stop offset="100%" stopColor="#1DB954" />
        </linearGradient>
      </defs>
      <circle cx="44" cy="44" r="40" fill="#0D1829" stroke="url(#navG)" strokeWidth="2" />
      <line x1="22" y1="28" x2="44" y2="44" stroke="#E5373A" strokeWidth="5" strokeLinecap="round" />
      <line x1="22" y1="60" x2="44" y2="44" stroke="#E5373A" strokeWidth="5" strokeLinecap="round" />
      <line x1="44" y1="44" x2="56" y2="56" stroke="#1DB954" strokeWidth="5" strokeLinecap="round" />
      <line x1="56" y1="56" x2="72" y2="28" stroke="#1DB954" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/* ─────────────── Hero ─────────────── */
function Hero() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 pt-14 pb-20 lg:pt-20">
      <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <motion.div
          initial="hidden"
          animate="show"
          variants={stagger}
          className="text-center lg:text-left"
        >
          <motion.div
            variants={fadeUp}
            className="inline-flex items-center gap-2 rounded-full border border-brand-green/30 bg-brand-green/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-green"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-green" />
            Early Access Open
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="mt-5 text-[40px] font-black leading-[1.02] tracking-tight md:text-[58px]"
          >
            Stop <span className="text-brand-red">Skipping</span> Jobs.
            <br />
            Apply and{" "}
            <span className="text-brand-green">sound like yourself</span> on
            every one.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-sub lg:mx-0"
          >
            Aplyer is a Chrome extension that fills long essay questions on job
            applications in your own voice — using your resume. Works inside
            Workday, Greenhouse, Lever, and any employer careers page.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="mt-7 flex flex-col items-center gap-3 sm:flex-row lg:items-start"
          >
            <Link
              to="/dashboard"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green px-6 py-3.5 text-[15px] font-bold text-primary-foreground shadow-[0_18px_40px_-14px_rgba(29,185,84,0.7)] transition-transform hover:scale-[1.02] sm:w-auto"
            >
              Open Dashboard
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <button
              type="button"
              onClick={() => void downloadExtension().catch((err) => alert(err.message))}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-paper/60 px-6 py-3.5 text-[15px] font-semibold text-foreground transition-colors hover:border-brand-green/40 sm:w-auto"
            >
              <Download className="h-4 w-4" />
              Download Extension
            </button>
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {[
              { l: "Status", v: "● Early Access", green: true },
              { l: "Works on", v: ["Workday", "Greenhouse", "Lever"] },
              { l: "Requires", v: "Google Chrome" },
              { l: "Pricing", v: "Free to join" },
            ].map((m, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="rounded-lg border border-border bg-paper/60 p-3 text-left"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {m.l}
                </div>
                <div
                  className={`mt-1 text-[13px] font-semibold ${m.green ? "text-brand-green" : "text-foreground"}`}
                >
                  {Array.isArray(m.v) ? (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {m.v.map((platform) => (
                        <li key={platform}>{platform}</li>
                      ))}
                    </ul>
                  ) : (
                    m.v
                  )}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        {/* Extension preview */}
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, ease: "easeOut", delay: 0.1 }}
          className="relative mx-auto max-w-full"
        >
          <div
            aria-hidden
            className="absolute -inset-8 -z-10 rounded-[40px] opacity-80 blur-3xl"
            style={{
              background:
                "radial-gradient(50% 50% at 50% 30%, rgba(29,185,84,0.35), transparent 70%)",
            }}
          />

          <div className="mb-3 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-paper/80 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-brand-green" />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Chrome Extension Preview
              </span>
            </div>
            <p className="mt-2 text-[13px] text-sub">
              See how Aplyer works while you apply.
            </p>
          </div>

          <div
            aria-hidden="true"
            role="img"
            aria-label="Chrome Extension Preview"
            className="pointer-events-none overflow-hidden rounded-[28px] border border-white/10 bg-paper shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]"
          >
            <div className="flex items-center gap-1.5 border-b border-border bg-[#0a1322] px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                aplyer · popup
              </span>
            </div>
            <div className="h-[620px] w-[400px] max-w-full overflow-hidden bg-background">
              <PopupApp preview />
            </div>
          </div>

          <p className="mt-4 text-center text-[13px] leading-relaxed text-sub lg:text-left">
            This is a preview of the Aplyer Chrome extension.
            <br />
            Install the extension to use Aplyer while applying for jobs.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

/* ─────────────── Compare (Bad vs Good) ─────────────── */
function CompareSection() {
  return (
    <Section className="mx-auto max-w-6xl px-6 py-20">
      <motion.div variants={fadeUp} className="mx-auto max-w-3xl text-center">
        <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-brand-green">
          Q.01 — The Problem
        </span>
        <h2 className="mt-3 text-[28px] font-black leading-tight tracking-tight md:text-[40px]">
          Why are you <span className="text-brand-red">skipping</span> so many
          jobs — and can Aplyer help?
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-sub">
          You skip applications not because you're unqualified, but because
          you're exhausted from 20 essay prompts in a day.{" "}
          <span className="text-brand-green">
            Aplyer was built for these moments.
          </span>
        </p>
      </motion.div>

      <motion.div
        variants={fadeUp}
        className="mt-12 grid items-stretch gap-6 md:grid-cols-[1fr_auto_1fr]"
      >
        <BrowserPane variant="bad" />
        <div className="flex flex-row items-center justify-center gap-3 md:flex-col">
          <motion.div
            animate={{ x: [0, 6, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="rounded-full border border-brand-green/40 bg-brand-green/10 p-3"
          >
            <Sparkles className="h-5 w-5 text-brand-green" />
          </motion.div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-green">
            Aplyer
          </div>
        </div>
        <BrowserPane variant="good" />
      </motion.div>
    </Section>
  );
}

function BrowserPane({ variant }: { variant: "bad" | "good" }) {
  const bad = variant === "bad";
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 250, damping: 20 }}
      className={`overflow-hidden rounded-2xl border ${
        bad
          ? "border-brand-red/30 bg-red-dim"
          : "border-brand-green/30 bg-green-dim"
      }`}
    >
      <div
        className={`flex items-center gap-1.5 px-4 py-2.5 ${
          bad ? "bg-brand-red/10" : "bg-brand-green/10"
        }`}
      >
        <span className="h-2 w-2 rounded-full bg-brand-red/60" />
        <span className="h-2 w-2 rounded-full bg-yellow-500/60" />
        <span className={`h-2 w-2 rounded-full ${bad ? "bg-foreground/20" : "bg-brand-green"}`} />
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
          careers.company.com
        </span>
      </div>
      <div className="flex flex-col gap-3 p-5">
        <div className="font-mono text-[12px] text-sub">
          Why do you want to work here?
        </div>
        {bad ? (
          <div className="rounded-md border border-dashed border-brand-red/40 bg-red-dim p-4 text-[13px] italic text-brand-red/70">
            Start typing your answer...
          </div>
        ) : (
          <Typewriter
            text="I've spent the last 10 years in this industry and your team is doing the work I genuinely want to be part of. The problems you're solving are exactly what I've focused on — I know I can contribute from day one."
          />
        )}
        <div
          className={`mt-1 rounded px-3 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.12em] ${
            bad
              ? "bg-brand-red/15 text-brand-red"
              : "bg-brand-green/15 text-brand-green"
          }`}
        >
          {bad ? "✕ Page closed · Job skipped" : "✓ Application submitted"}
        </div>
      </div>
    </motion.div>
  );
}

function Typewriter({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? text : "");
  useEffect(() => {
    if (reduce) return;
    let i = 0;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      i += 2;
      setShown(text.slice(0, i));
      if (i < text.length) setTimeout(tick, 22);
    };
    const start = setTimeout(tick, 600);
    return () => {
      mounted = false;
      clearTimeout(start);
    };
  }, [text, reduce]);
  return (
    <div className="min-h-[120px] rounded-md border border-brand-green/40 bg-green-dim p-4 text-[13px] leading-relaxed text-brand-green">
      {shown}
      <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-1 animate-pulse bg-brand-green" />
    </div>
  );
}

/* ─────────────── How it works ─────────────── */
function HowItWorks() {
  const steps = [
    {
      icon: Upload,
      title: "Upload your resume",
      body: "Drop in your PDF once. Aplyer parses your experience, skills, and tone.",
    },
    {
      icon: Wand2,
      title: "Aplyer reads the question",
      body: "It detects the field on any careers page and writes an answer in your voice.",
    },
    {
      icon: Send,
      title: "Review and submit",
      body: "You stay in control — read it, tweak it, hit submit. Job sent instead of skipped.",
    },
  ];
  return (
    <Section id="how" className="mx-auto max-w-6xl px-6 py-20">
      <motion.div variants={fadeUp} className="mx-auto max-w-2xl text-center">
        <span className="font-mono text-[13px] uppercase tracking-[0.18em] text-brand-green">
          Q.02 — How it works
        </span>
        <h2 className="mt-3 text-[30px] font-black tracking-tight md:text-[44px]">
          Three steps to a sent application.
        </h2>
      </motion.div>

      <motion.div variants={stagger} className="mt-12 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <motion.div
            key={i}
            variants={fadeUp}
            whileHover={{ y: -6 }}
            className="group relative overflow-hidden rounded-2xl border border-border bg-paper p-6 transition-colors hover:border-brand-green/40"
          >
            <div
              aria-hidden
              className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-green/10 opacity-0 blur-2xl transition-opacity group-hover:opacity-100"
            />
            <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-green/15 text-brand-green">
              <s.icon className="h-5 w-5" />
            </div>
            <div className="font-mono text-[12px] text-muted-foreground">
              Step {String(i + 1).padStart(2, "0")}
            </div>
            <h3 className="mt-1 text-[20px] font-bold">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-sub">{s.body}</p>
          </motion.div>
        ))}
      </motion.div>
    </Section>
  );
}

/* ─────────────── Stats ─────────────── */
function StatsRow() {
  const stats = [
    { n: "1,200+", l: "Essay prompts faced per active job seeker each year", icon: Briefcase },
    { n: "62%", l: "Of applications abandoned at open-ended questions", icon: X },
    { n: "3.4×", l: "More applications sent after installing Aplyer", icon: Zap },
    { n: "100%", l: "Your voice — never a generic AI answer", icon: ShieldCheck },
  ];
  return (
    <Section className="mx-auto max-w-6xl px-6 py-12">
      <motion.div
        variants={fadeUp}
        className="overflow-hidden rounded-2xl border border-border bg-paper"
      >
        <div className="grid gap-px bg-border md:grid-cols-4">
          {stats.map((s, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              className="bg-paper p-6"
            >
              <s.icon className="h-4 w-4 text-brand-green" />
              <div className="mt-3 font-mono text-[32px] leading-none text-brand-green">
                {s.n}
              </div>
              <div className="mt-2 text-[13px] leading-relaxed text-sub">
                {s.l}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </Section>
  );
}


/* ─────────────── Final CTA ─────────────── */
function FinalCTA() {
  return (
    <Section className="mx-auto max-w-4xl px-6 pb-24">
      <motion.div
        variants={fadeUp}
        className="relative overflow-hidden rounded-3xl border border-brand-green/30 bg-gradient-to-br from-brand-green/15 via-paper to-paper p-10 text-center md:p-14"
      >
        <div
          aria-hidden
          className="absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-brand-green/30 blur-3xl"
        />
        <span className="relative font-mono text-[12px] uppercase tracking-[0.18em] text-brand-green">
          Ready when you are
        </span>
        <h2 className="relative mt-3 text-[30px] font-black tracking-tight md:text-[44px]">
          Apply to the next job —{" "}
          <span className="text-brand-green">don't skip it.</span>
        </h2>
        <p className="relative mx-auto mt-3 max-w-xl text-[15px] text-sub">
          Install the extension, upload your resume, and let Aplyer handle the
          essay questions on every careers page.
        </p>
        <div className="relative mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 rounded-xl bg-brand-green px-6 py-3.5 text-[15px] font-bold text-primary-foreground shadow-[0_18px_40px_-14px_rgba(29,185,84,0.7)] transition-transform hover:scale-[1.03]"
          >
            Open Dashboard
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Check className="h-4 w-4 text-brand-green" />
            Free during early access
          </div>
        </div>
      </motion.div>
    </Section>
  );
}

/* ─────────────── Footer ─────────────── */
function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 sm:flex-row">
        <div className="flex items-center gap-2 text-[13px] text-sub">
          <LogoMark />
          <span>© {new Date().getFullYear()} Aplyer.ai — Stop Skipping Jobs</span>
        </div>
        <div className="flex gap-5 text-[13px] text-sub">
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="mailto:hello@aplyer.ai" className="hover:text-foreground">Contact</a>
        </div>
      </div>
    </footer>
  );
}
