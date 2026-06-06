import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FileText,
  User,
  BookOpen,
  CreditCard,
  Settings,
  LifeBuoy,
  LogOut,
  Sparkles,
  Chrome,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const nav: Array<{ to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }> = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/dashboard/resume", label: "Resume", icon: FileText },
  { to: "/dashboard/profile", label: "Profile", icon: User },
  { to: "/dashboard/writing", label: "Writing Samples", icon: BookOpen },
  { to: "/dashboard/subscription", label: "Subscription", icon: CreditCard },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
  { to: "/dashboard/support", label: "Support", icon: LifeBuoy },
];

export function Sidebar() {
  const loc = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/auth", replace: true });
  }

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r border-border bg-card lg:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-green text-[#06140A]">
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="text-[15px] font-black tracking-tight text-foreground">aplyer.ai</span>
      </div>

      <nav className="flex-1 px-3 py-2">
        <div className="px-2 pb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          Workspace
        </div>
        {nav.map((item) => {
          const active = item.exact
            ? loc.pathname === item.to
            : loc.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <a
              key={item.to}
              href={item.to}
              className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                active
                  ? "bg-brand-green/10 text-brand-green"
                  : "text-sub hover:bg-field hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <a
          href="/aplyer-extension.zip"
          download
          className="mb-2 flex items-center gap-2 rounded-lg border border-brand-green/25 bg-brand-green/5 px-3 py-2.5 text-[12px] text-brand-green hover:bg-brand-green/10"
        >
          <Chrome className="h-4 w-4" />
          Install extension
        </a>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-muted-foreground hover:bg-field hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
