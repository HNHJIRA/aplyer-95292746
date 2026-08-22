import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "@/components/extension/PopupApp";
import "@/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    {/* Chrome caps popup height at 600px — anything taller gets clipped. */}
    <div className="flex h-[600px] w-[420px] flex-col overflow-hidden bg-background font-sans text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <PopupApp />
      </div>
      <div className="shrink-0 border-t border-border bg-paper px-4 py-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Powered by WriteDNA Technology™ · <a className="text-brand-green hover:underline" href="https://www.aplyer.ai/" target="_blank" rel="noreferrer">aplyer.ai</a>
      </div>
    </div>
  </StrictMode>
);
