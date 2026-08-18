import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "@/components/extension/PopupApp";
import "@/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    {/* Chrome caps popup height at 600px — anything taller gets clipped. */}
    <div className="flex h-[600px] w-[420px] flex-col overflow-hidden bg-background">


      <PopupApp />
    </div>
  </StrictMode>
);
