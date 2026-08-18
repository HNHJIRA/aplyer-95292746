import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";
import { runFraudScan } from "@/lib/fraud/scan";
import { MAX_URL_LENGTH } from "@/lib/fraud/trusted-ats";

export const Route = createFileRoute("/api/public/job-safety-check")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID();
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const url = body.url;

        if (typeof url !== "string" || !url.trim()) {
          return jsonWithCors({ ok: false, error: "url is required" }, 400, request);
        }
        if (url.length > MAX_URL_LENGTH) {
          return jsonWithCors({ ok: false, error: "url exceeds maximum length" }, 400, request);
        }

        // Any client-supplied `provider`/`trusted` fields are ignored on purpose.
        const result = await runFraudScan(url, { requestId });

        if (result.status === "invalid") {
          return jsonWithCors({ ok: false, error: result.reason, requestId }, 400, request);
        }

        return jsonWithCors({ ok: true, requestId, result }, 200, request);
      },
    },
  },
});
