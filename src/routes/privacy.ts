import { createFileRoute } from "@tanstack/react-router";
import html from "@/legacy/privacy.html?raw";

// Client-supplied legal document, served byte-for-byte (no rewriting).
export const Route = createFileRoute("/privacy")({
  server: {
    handlers: {
      GET: async () =>
        new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    },
  },
});
