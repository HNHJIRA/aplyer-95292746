import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/support")({
  component: SupportPage,
});

/** Every answer below describes behavior that exists in the product today. */
const FAQS: { q: string; a: string }[] = [
  {
    q: "How do I upload my resume?",
    a: "Open the Resume page and drop in a PDF, DOCX or TXT file up to 10 MB. Aplyer reads the text, scores it, and keeps your previous versions in the version history so you can see what changed.",
  },
  {
    q: "How is my Resume Score calculated?",
    a: "It is calculated on your device from the text of your resume. Six sections earn points when they are found — experience, contact information, skills, education, professional summary and certifications — plus a bonus for length and a bonus for numbers and percentages. The Resume page shows which sections were found.",
  },
  {
    q: "How does Write DNA work?",
    a: "Write DNA has three steps: upload your resume, add a first qualifying writing sample, then add a second. A sample qualifies when it is at least 100 characters and at least 30 words of prose. Your progress shows 33%, 67% and 100% as you complete each step.",
  },
  {
    q: "When does my Voice Card become available?",
    a: "Your Voice Card unlocks once you have a resume plus two qualifying writing samples. Before that it stays locked. If you add or change your resume or samples afterwards, the Voice Card is marked out of date and you can regenerate it.",
  },
  {
    q: "How do I use the Chrome extension?",
    a: "Install the extension, sign in with the same account, and open a job application. Aplyer detects supported job sites and shows its panel with the questions it found on the page.",
  },
  {
    q: "How do I generate an answer?",
    a: "Choose a detected question in the extension panel and select Generate Answer. Aplyer writes from the facts in your resume, checks the answer, and then you can use it, copy it, or ask for a new one.",
  },
  {
    q: "How does Autofill All work?",
    a: "Autofill All fills the standard application details Aplyer already knows about you, such as your name, email and phone. When it meets a field it has not seen before it asks you, and remembers your answer for next time.",
  },
  {
    q: "How do saved answers work?",
    a: "When you answer a question in an application, Aplyer stores that answer against the question so the same question can be filled automatically on later applications. If you correct an answer, the correction is what gets saved.",
  },
];

function SupportPage() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[32px] font-black tracking-tight">Customer Support</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">We typically reply to requests within a few hours</p>
      </div>

      <a
        href="mailto:support@aplyer.ai"
        className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:border-brand-green/40"
      >
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-green/10 text-brand-green">
          <Mail className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-[16px] font-bold">Email us</span>
          <span className="block text-[14px] text-muted-foreground">support@aplyer.ai</span>
        </span>
      </a>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">Guides &amp; FAQs</div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q} className="rounded-xl border border-border bg-paper">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="text-[15px] font-semibold">{f.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && <p className="px-4 pb-3.5 text-[14px] leading-relaxed text-sub">{f.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
