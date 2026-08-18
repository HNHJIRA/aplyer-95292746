/**
 * Centralized trusted-ATS allowlist.
 *
 * This is the SINGLE source of truth for ATS domain rules. Do not duplicate
 * these domains in routes, adapters, or the extension.
 *
 * Scope note (compliance): matching here only proves the job page is hosted on
 * a recognized applicant tracking platform. It does NOT prove the employer is
 * legitimate, that the listing is real, or that the role exists.
 */

export type TrustedAtsProvider = "greenhouse" | "lever" | "workday";

/** Root domains only — subdomains are handled by strict suffix matching. */
export const TRUSTED_ATS_DOMAINS = ["greenhouse.io", "lever.co", "myworkdayjobs.com"] as const;

const PROVIDER_BY_DOMAIN: Record<string, TrustedAtsProvider> = {
  "greenhouse.io": "greenhouse",
  "lever.co": "lever",
  "myworkdayjobs.com": "workday",
};

/** Hard limit so malformed/oversized payloads never reach the parser hot path. */
export const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export interface ParsedJobUrl {
  ok: boolean;
  reason?: string;
  hostname?: string;
  /** Origin + pathname, no query/fragment — used as the cache key. */
  normalizedUrl?: string;
  protocol?: string;
}

/** Parse + normalize a candidate job URL. Never throws. */
export function parseJobUrl(input: unknown): ParsedJobUrl {
  if (typeof input !== "string") return { ok: false, reason: "url must be a string" };
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "url is required" };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "url exceeds maximum length" };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "url is malformed" };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: "unsupported protocol" };
  }

  // URL already lowercases + punycodes the host; strip a trailing root dot.
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (!hostname) return { ok: false, reason: "url is malformed" };

  return {
    ok: true,
    hostname,
    protocol: parsed.protocol,
    normalizedUrl: `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}`,
  };
}

/** Strict match: exact root domain, or a true subdomain of it. */
export function matchTrustedDomain(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  for (const domain of TRUSTED_ATS_DOMAINS) {
    if (host === domain) return domain;
    if (host.endsWith(`.${domain}`)) return domain;
  }
  return null;
}

/** Provider key for a URL, or null when the URL is not a trusted ATS URL. */
export function getTrustedAtsProvider(url: string): TrustedAtsProvider | null {
  const parsed = parseJobUrl(url);
  if (!parsed.ok || !parsed.hostname) return null;
  const domain = matchTrustedDomain(parsed.hostname);
  return domain ? PROVIDER_BY_DOMAIN[domain] : null;
}

/** True only for well-formed http(s) URLs hosted on an allowlisted ATS. */
export function isTrustedAtsUrl(url: string): boolean {
  return getTrustedAtsProvider(url) !== null;
}
