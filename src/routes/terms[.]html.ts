import { createFileRoute } from "@tanstack/react-router";
import html from "@/legacy/terms.html?raw";

// The supplied documents link to each other as "terms.html"; serve that too.
export const Route = createFileRoute("/terms.html")({
  server: {
    handlers: {
      GET: async () =>
        new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    },
  },
});
