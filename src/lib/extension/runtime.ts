// Helpers for detecting and talking to the host Chrome extension runtime.

export interface ExtensionSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: { id: string; email?: string | null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chromeApi(): any {
  if (typeof globalThis === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  return c?.runtime?.id ? c : null;
}

export function isExtensionRuntime(): boolean {
  return !!chromeApi();
}

export function getExtensionId(): string | null {
  const c = chromeApi();
  return c?.runtime?.id ?? null;
}

export async function getExtensionSession(): Promise<ExtensionSession | null> {
  const c = chromeApi();
  if (!c) return null;
  return new Promise((resolve) => {
    c.runtime.sendMessage({ type: "APLYER_GET_SESSION" }, (res: { session: ExtensionSession | null }) => {
      resolve(res?.session ?? null);
    });
  });
}

export async function signOutExtension(): Promise<void> {
  const c = chromeApi();
  if (!c) return;
  return new Promise((resolve) => {
    c.runtime.sendMessage({ type: "APLYER_SIGN_OUT" }, () => resolve());
  });
}

export function openAuthInTab(webUrl: string) {
  const c = chromeApi();
  const id = c?.runtime?.id;
  const url = `${webUrl.replace(/\/$/, "")}/extension-auth?ext=${encodeURIComponent(id ?? "")}`;
  if (c?.tabs?.create) {
    c.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

// Web URL the extension popup uses to open the auth bridge.
// Override at build time via VITE_APP_URL.
export const APP_WEB_URL =
  (import.meta.env?.VITE_APP_URL as string | undefined) ||
  "https://aplyer-sparkle-foundation.lovable.app";

export function openWebPath(path: string) {
  const url = `${APP_WEB_URL.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const c = chromeApi();
  if (c?.tabs?.create) {
    c.tabs.create({ url });
  } else if (typeof window !== "undefined") {
    window.location.href = url;
  }
}
