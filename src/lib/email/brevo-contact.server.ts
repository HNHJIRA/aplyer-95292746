/**
 * Brevo contact-list synchronisation — SERVER ONLY.
 *
 * Extracted from the subscribe route so it can run as a background job.
 * Idempotent by construction: Brevo upserts on email (`updateEnabled: true`)
 * and a `duplicate_parameter` response is treated as success.
 */

const BREVO_CONTACTS_URL = "https://api.brevo.com/v3/contacts";
const BREVO_LIST_ID = 3;

export interface ContactSyncResult {
  ok: boolean;
  status: "synced" | "skipped" | "failed";
  errorCode?: string;
  httpStatus?: number;
}

export async function syncBrevoContact(input: {
  email: string;
  firstName?: string | null;
  source?: string | null;
}): Promise<ContactSyncResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn("[brevo-contact] status=skipped reason=missing_api_key");
    return { ok: false, status: "skipped", errorCode: "missing_api_key" };
  }

  try {
    const res = await fetch(BREVO_CONTACTS_URL, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        listIds: [BREVO_LIST_ID],
        updateEnabled: true,
        attributes: {
          SOURCE: input.source ?? "",
          ...(input.firstName ? { FIRSTNAME: input.firstName } : {}),
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) return { ok: true, status: "synced", httpStatus: res.status };

    const text = await res.text().catch(() => "");
    let code = `http_${res.status}`;
    try {
      const parsed = JSON.parse(text) as { code?: string };
      if (parsed.code) code = String(parsed.code).slice(0, 64);
    } catch {
      /* non-JSON body */
    }

    // Existing contact is a success for our purposes.
    if (res.status === 400 && code === "duplicate_parameter") {
      return { ok: true, status: "synced", httpStatus: res.status };
    }

    console.warn(`[brevo-contact] status=failed http=${res.status} code=${code}`);
    return { ok: false, status: "failed", errorCode: code, httpStatus: res.status };
  } catch (e) {
    const errorCode = e instanceof Error ? e.name : "unknown_error";
    console.warn(`[brevo-contact] status=failed code=${errorCode}`);
    return { ok: false, status: "failed", errorCode };
  }
}
