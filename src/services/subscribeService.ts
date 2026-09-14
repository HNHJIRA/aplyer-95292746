// Subscribe service — calls the shared backend hosted in the sibling Lovable project.
import { apiUrl } from "@/lib/api-base";

const SUBSCRIBE_ENDPOINT = apiUrl("/api/public/subscribe");
const UPLOAD_ENDPOINT = apiUrl("/api/public/waitlist-upload");

export interface SubscribeResult {
  ok: boolean;
  error?: string;
}

const FILE_FIELDS = new Set(["resume", "cover", "coverLetter", "writingSample"]);
export const SUBSCRIBE_TIMEOUT_MS = 25_000;
export const UPLOAD_TIMEOUT_MS = 30_000;

const GENERIC_ERROR = "Something went wrong. Please try again.";
const TIMEOUT_ERROR = "The request took too long. Please try again.";
const UPLOAD_ERROR = "Your details were saved, but your file upload failed. Please try again.";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

async function errorFromResponse(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" && data.error.trim() ? data.error : fallback;
}

async function uploadFiles(source: FormData): Promise<SubscribeResult> {
  const files: Array<[string, File]> = [];
  for (const [key, value] of source.entries()) {
    if (value instanceof File && value.size > 0) {
      files.push([FILE_FIELDS.has(key) ? key : key, value]);
    }
  }
  if (files.length === 0) return { ok: true };

  const fd = new FormData();
  const email = source.get("email");
  const name = source.get("firstName") ?? source.get("name");
  if (typeof email === "string") fd.append("email", email);
  if (typeof name === "string" && name) fd.append("name", name);
  fd.append("source", "waitlist-form");
  for (const [k, f] of files) fd.append(k, f);

  try {
    const response = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, error: await errorFromResponse(response, UPLOAD_ERROR) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: isAbortError(error) ? TIMEOUT_ERROR : UPLOAD_ERROR };
  }
}

export async function subscribe(formData: FormData): Promise<SubscribeResult> {
  try {
    const res = await fetch(SUBSCRIBE_ENDPOINT, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(SUBSCRIBE_TIMEOUT_MS),
    });
    if (res.ok) {
      return await uploadFiles(formData);
    }
    return { ok: false, error: await errorFromResponse(res, GENERIC_ERROR) };
  } catch (error) {
    return { ok: false, error: isAbortError(error) ? TIMEOUT_ERROR : GENERIC_ERROR };
  }
}
