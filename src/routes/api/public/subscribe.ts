import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const Route = createFileRoute("/api/public/subscribe")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            email?: unknown;
            source?: unknown;
          };
          const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
          const source =
            typeof body.source === "string" ? body.source.trim().slice(0, 64) : null;

          if (!EMAIL_RE.test(email) || email.length > 254) {
            return jsonWithCors({ error: "Please enter a valid email address." }, 400);
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin
            .from("waitlist_subscribers")
            .upsert({ email, source }, { onConflict: "email,source", ignoreDuplicates: true });

          if (error) {
            console.error("[subscribe]", error);
            return jsonWithCors({ error: "Something went wrong. Please try again." }, 500);
          }

          return jsonWithCors({ ok: true });
        } catch (err) {
          console.error("[subscribe]", err);
          return jsonWithCors({ error: "Something went wrong. Please try again." }, 500);
        }
      },
    },
  },
});
