import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { ArrowLeft, Shield, LifeBuoy, FileText, PenLine, User as UserIcon, LogOut, RotateCcw } from "lucide-react";
import { Button } from "../ui/Button";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";

type Section = "account" | "resume" | "profile" | "writing" | "support" | "privacy";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "account", label: "Account", icon: <UserIcon className="h-3.5 w-3.5" /> },
  { id: "resume", label: "Resume", icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "profile", label: "Profile", icon: <UserIcon className="h-3.5 w-3.5" /> },
  { id: "writing", label: "Writing", icon: <PenLine className="h-3.5 w-3.5" /> },
  { id: "support", label: "Support", icon: <LifeBuoy className="h-3.5 w-3.5" /> },
  { id: "privacy", label: "Privacy", icon: <Shield className="h-3.5 w-3.5" /> },
];

export function Settings({ onBack, onLogout }: { onBack: () => void; onLogout?: () => void | Promise<void> }) {
  const { state, update, reset } = useAplyerStore();
  const [section, setSection] = useState<Section>("account");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);


  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-paper/60 px-4 py-3 backdrop-blur">
        <button onClick={onBack} className="rounded-md p-1 text-muted-foreground hover:bg-field hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-[16px] font-bold">Settings</h2>
      </div>

      <div className="popup-scroll flex gap-0 overflow-hidden">
        <nav className="popup-scroll w-[112px] flex-shrink-0 overflow-y-auto border-r border-border bg-paper/40 py-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition ${section === s.id ? "border-l-2 border-brand-green bg-brand-green/10 text-brand-green" : "border-l-2 border-transparent text-muted-foreground hover:bg-field hover:text-foreground"}`}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>

        <div className="popup-scroll flex-1 overflow-y-auto p-4">
          <motion.div key={section} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            {section === "account" && (
              <Card title="Account">
                <Row label="Plan" value={state.subscriptionStatus.tier.toUpperCase()} />
                <Row label="Last sync" value={state.lastUpdated ? new Date(state.lastUpdated).toLocaleString() : "Not available"} />
                <Row label="Storage" value="chrome.storage.local" />
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={reset}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset Onboarding
                </Button>
                <button
                  onClick={() => setConfirmLogout(true)}
                  className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-[14px] font-semibold text-brand-red transition hover:bg-brand-red/15"
                >
                  <LogOut className="h-3.5 w-3.5" /> Logout
                </button>

              </Card>
            )}

            {section === "resume" && (
              <Card title="Resume">
                {state.resumeMetadata ? (
                  <>
                    <Row label="File" value={state.resumeMetadata.fileName} />
                    <Row label="Size" value={`${(state.resumeMetadata.fileSize / 1024).toFixed(1)} KB`} />
                    <Row label="Uploaded" value={new Date(state.resumeMetadata.uploadedAt).toLocaleDateString()} />
                    <Row label="Score" value={`${state.resumeScore?.score ?? 0}/100`} />
                  </>
                ) : (
                  <Empty>No resume uploaded yet.</Empty>
                )}
              </Card>
            )}

            {section === "profile" && (
              <Card title="Profile">
                {state.profile ? (
                  Object.entries(state.profile).map(([k, v]) => <Row key={k} label={k} value={v || "Not available"} />)
                ) : (
                  <Empty>Profile not completed.</Empty>
                )}
              </Card>
            )}

            {section === "writing" && (
              <Card title="Writing Samples">
                <Row label="Samples" value={String(state.writingSamples.length)} />
                <Row label="Total words" value={String(state.writingSamples.reduce((a, s) => a + s.wordCount, 0))} />
                {state.writingSamples.length === 0 && <Empty>None yet.</Empty>}
              </Card>
            )}

            {section === "support" && (
              <Card title="Support">
                <LinkRow label="Help Center" />
                <LinkRow label="Report a bug" />
                <LinkRow label="Contact us" />
                <LinkRow label="What's new" />
              </Card>
            )}

            {section === "privacy" && (
              <Card title="Privacy">
                <Toggle label="Anonymous telemetry" checked={state.settings.telemetry} onChange={(v) => update({ settings: { ...state.settings, telemetry: v } })} />
                <Toggle label="Autofill enabled" checked={state.settings.autofillEnabled} onChange={(v) => update({ settings: { ...state.settings, autofillEnabled: v } })} />
                <Toggle label="Notifications" checked={state.settings.notifications} onChange={(v) => update({ settings: { ...state.settings, notifications: v } })} />
                <p className="mt-3 text-[13px] text-muted-foreground">Your resume is saved on this device and synchronized with your Aplyer account when you are signed in.</p>
              </Card>
            )}
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {confirmLogout && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-navy/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="mx-4 w-full max-w-[320px] rounded-2xl border border-border bg-paper p-5 shadow-2xl"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-red/15 text-brand-red">
                  <LogOut className="h-4 w-4" />
                </span>
                <h3 className="text-[17px] font-bold">Sign out?</h3>
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
                You'll be signed out of the extension. Your data remains safely stored in your Aplyer account.
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setConfirmLogout(false)}
                  disabled={loggingOut}
                >
                  Cancel
                </Button>
                <button
                  disabled={loggingOut}
                  onClick={async () => {
                    setLoggingOut(true);
                    try {
                      await onLogout?.();
                    } finally {
                      setLoggingOut(false);
                      setConfirmLogout(false);
                    }
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-red px-3 py-2 text-[14px] font-semibold text-white transition hover:bg-brand-red/90 disabled:opacity-60"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {loggingOut ? "Signing out…" : "Logout"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-paper p-3">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-[13px] capitalize text-muted-foreground">{label}</span>
      <span className="truncate text-[13px] text-foreground">{value}</span>
    </div>
  );
}

function LinkRow({ label }: { label: string }) {
  return (
    <button className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-[14px] text-foreground hover:bg-field">
      {label}
      <span className="text-muted-foreground">›</span>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex w-full items-center justify-between py-2">
      <span className="text-[14px]">{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-brand-green" : "bg-field-2"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? "left-4" : "left-0.5"}`} />
      </span>
    </button>
  );
}
