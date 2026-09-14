// Base URL for the shared backend (hosted in the sibling Lovable project).
// Override at build time by setting VITE_API_BASE_URL.
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "https://aplyer.devssh.xyz";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${p}`;
}
