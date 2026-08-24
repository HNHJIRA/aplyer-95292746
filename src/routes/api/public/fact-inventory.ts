// Extension-facing endpoint for P0 canonical fact inventory state.
//
// ROUTE CONVENTION: in this project `/api/public/*` means "callable by an
// external client (the browser extension) without the site-level auth gate".
// It does NOT mean unauthenticated: this handler enforces its own bearer-token
// check and resolves the user server-side, so the endpoint stays here (it is
// the namespace the extension is allowed to reach). No duplicate route exists.
//
// The request body may contain ONLY { ensure?: boolean }. Any inventory body,
// facts, evidence, source hash, resume id/text, model, prompt version or user
// id supplied by the client is ignored — the server derives all of them.
// Bearer-token authenticated; the user is resolved server-side. The client can
// never supply a user id, resume id, or any candidate fact.
import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";

export async function handleFactInventory(request: Request): Promise<Response> {
  try {
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!token) return jsonWithCors({ error: "Unauthorized" }, 401, request);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) return jsonWithCors({ error: "Unauthorized" }, 401, request);
    const userId = authData.user.id;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const ensure = body.ensure === true;

    const { ensureFactInventory, getFactInventoryState, FactInventoryError } = await import(
      "@/lib/ai/fact-inventory.server"
    );

    try {
      const state = ensure
        ? await ensureFactInventory(supabaseAdmin, userId)
        : await getFactInventoryState(supabaseAdmin, userId);
      // Never returns the inventory body to the browser in this phase.
      return jsonWithCors({ ok: true, ...state, inventory: undefined }, 200, request);
    } catch (e) {
      if (e instanceof FactInventoryError) {
        const status =
          e.code === "no_resume" || e.code === "empty_resume"
            ? 409
            : e.code === "model_unavailable" || e.code === "not_configured"
              ? 503
              : 502;
        return jsonWithCors({ ok: false, code: e.code, error: e.message }, status, request);
      }
      throw e;
    }
  } catch (e) {
    console.error("[fact-inventory]", e);
    return jsonWithCors(
      { ok: false, code: "extraction_failed", error: "We couldn't prepare your profile context." },
      500,
      request,
    );
  }
}

export const Route = createFileRoute("/api/public/fact-inventory")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => handleFactInventory(request),
    },
  },
});
