import { createFileRoute } from "@tanstack/react-router";
import html from "@/legacy/terms.html?raw";

// Client-supplied legal document, served byte-for-byte (no rewriting).
export const Route = createFileRoute("/terms")({
  server: {
    handlers: {
      GET: async () =>
        new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    },
  },
});
