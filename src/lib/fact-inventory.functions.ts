// Server functions for the P0 canonical resume fact inventory.
// user_id always comes from the authenticated server context, never the client.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getResumeFactInventoryStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getFactInventoryState } = await import("@/lib/ai/fact-inventory.server");
    return getFactInventoryState(context.supabase, context.userId);
  });

export const extractResumeFactInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { force?: boolean } | undefined) => ({ force: Boolean(input?.force) }))
  .handler(async ({ data, context }) => {
    const { ensureFactInventory, FactInventoryError } = await import(
      "@/lib/ai/fact-inventory.server"
    );
    try {
      return await ensureFactInventory(context.supabase, context.userId, { force: data.force });
    } catch (e) {
      if (e instanceof FactInventoryError) {
        return {
          status: "failed" as const,
          resumeId: null,
          schemaVersion: "",
          promptVersion: "",
          model: null,
          sourceHashPrefix: null,
          factCount: 0,
          generatedAt: null,
          error: e.code,
          message: e.message,
        };
      }
      throw e;
    }
  });
