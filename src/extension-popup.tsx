import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "@/components/extension/PopupApp";
import "@/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <div className="h-[650px] w-[420px] overflow-hidden bg-background">
      <PopupApp />
    </div>
  </StrictMode>
);
