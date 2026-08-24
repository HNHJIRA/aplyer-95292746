import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";
import { classifyQuestion } from "@/lib/ai/classify-question.server";

// Alias of /api/public/ai/classify-question (same auth + behaviour) so both
// documented paths work for the extension and the web app.
export const Route = createFileRoute("/api/ai/classify-question")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
          if (!token) return jsonWithCors({ error: "Unauthorized" }, 401, request);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
          if (authError || !authData.user) return jsonWithCors({ error: "Unauthorized" }, 401, request);

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const question = typeof body.question === "string" ? body.question.trim() : "";
          if (question.length < 5) return jsonWithCors({ error: "question is required" }, 400, request);
          if (question.length > 2000) return jsonWithCors({ error: "question too long" }, 400, request);

          const result = await classifyQuestion(supabaseAdmin, question, {
            platform: typeof body.platform === "string" ? body.platform : undefined,
            fieldType: typeof body.fieldType === "string" ? body.fieldType : undefined,
          });
          return jsonWithCors({ ok: true, ...result }, 200, request);
        } catch (e) {
          console.error("[classify-question]", e);
          return jsonWithCors({ error: "Classification failed" }, 500, request);
        }
      },
    },
  },
});
