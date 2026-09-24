import { createFileRoute } from "@tanstack/react-router";
import html from "@/legacy/privacy.html?raw";

// The supplied documents link to each other as "privacy.html"; serve that too.
export const Route = createFileRoute("/privacy.html")({
  server: {
    handlers: {
      GET: async () =>
        new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    },
  },
});
