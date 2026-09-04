import { createFileRoute } from "@tanstack/react-router";
import { Mail, BookOpen, MessageCircle, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/support")({
  component: SupportPage,
});

function SupportPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[32px] font-black tracking-tight">Customer Support</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">We typically reply to requests within a few hours</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card icon={<Mail className="h-5 w-5" />} title="Email us" desc="support@aplyer.ai" href="mailto:support@aplyer.ai" />
        <Card icon={<MessageCircle className="h-5 w-5" />} title="Live chat" desc="Coming soon" />
        <Card icon={<BookOpen className="h-5 w-5" />} title="Help center" desc="Guides, FAQs, troubleshooting" />
        <Card icon={<FileText className="h-5 w-5" />} title="Privacy & terms" desc="How we handle your data" />
      </div>
    </div>
  );
}

function Card({ icon, title, desc, href }: { icon: React.ReactNode; title: string; desc: string; href?: string }) {
  const Comp: React.ElementType = href ? "a" : "div";
  return (
    <Comp href={href} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:border-brand-green/40">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green/10 text-brand-green">{icon}</div>
      <div>
        <div className="text-[16px] font-bold">{title}</div>
        <div className="mt-0.5 text-[14px] text-muted-foreground">{desc}</div>
      </div>
    </Comp>
  );
}
