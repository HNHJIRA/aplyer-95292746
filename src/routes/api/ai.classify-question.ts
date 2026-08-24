import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/lib/cors";
import { handleClassifyQuestion } from "./public/ai.classify-question";

// Alias of /api/public/ai/classify-question (same auth + behaviour) so both
// documented paths work for the extension and the web app.
export const Route = createFileRoute("/api/ai/classify-question")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => handleClassifyQuestion(request),
    },
  },
});
