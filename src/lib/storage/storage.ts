import { DEFAULT_STATE, type AplyerState } from "./types";

/**
 * Storage abstraction.
 * Uses chrome.storage.local when available (extension context),
 * falls back to localStorage for web preview / development.
 */
const NAMESPACE = "aplyer.v1";

type ChromeStorageArea = {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
  clear: () => Promise<void>;
};

function getChromeStorage(): ChromeStorageArea | null {
  if (typeof globalThis === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  if (c?.storage?.local) return c.storage.local as ChromeStorageArea;
  return null;
}

async function rawGet<T>(key: string): Promise<T | null> {
  const chromeStorage = getChromeStorage();
  if (chromeStorage) {
    const result = await chromeStorage.get(key);
    return (result[key] as T) ?? null;
  }
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(key);
  return v ? (JSON.parse(v) as T) : null;
}

async function rawSet<T>(key: string, value: T): Promise<void> {
  const chromeStorage = getChromeStorage();
  if (chromeStorage) {
    await chromeStorage.set({ [key]: value });
    return;
  }
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

async function rawRemove(key: string): Promise<void> {
  const chromeStorage = getChromeStorage();
  if (chromeStorage) {
    await chromeStorage.remove(key);
    return;
  }
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(key);
}

type Listener = (state: AplyerState) => void;
const listeners = new Set<Listener>();

function emit(state: AplyerState) {
  for (const l of listeners) {
    try { l(state); } catch { /* ignore */ }
  }
}

export const storage = {
  async getState(): Promise<AplyerState> {
    const data = await rawGet<AplyerState>(NAMESPACE);
    if (!data) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...data, settings: { ...DEFAULT_STATE.settings, ...data.settings } };
  },
  async setState(state: AplyerState): Promise<void> {
    const next = { ...state, lastUpdated: new Date().toISOString() };
    await rawSet(NAMESPACE, next);
    emit(next);
  },
  async patch(partial: Partial<AplyerState>): Promise<AplyerState> {
    const current = await this.getState();
    const next = { ...current, ...partial, lastUpdated: new Date().toISOString() };
    await rawSet(NAMESPACE, next);
    emit(next);
    return next;
  },
  async reset(): Promise<void> {
    await rawRemove(NAMESPACE);
    emit(DEFAULT_STATE);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};

// Cross-context sync: chrome.storage.onChanged fires across all extension
// views. Bridge it so every useAplyerStore() instance in the same document
// stays in sync too (fixes stale PopupApp state when a child screen updates).
if (typeof globalThis !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).chrome;
  c?.storage?.onChanged?.addListener?.((changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local") return;
    const change = changes[NAMESPACE];
    if (!change || !change.newValue) return;
    const nv = change.newValue as Partial<AplyerState>;
    emit({ ...DEFAULT_STATE, ...nv, settings: { ...DEFAULT_STATE.settings, ...(nv.settings ?? {}) } });
  });
}
