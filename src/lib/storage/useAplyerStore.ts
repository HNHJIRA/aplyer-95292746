import { useCallback, useEffect, useState } from "react";
import { storage } from "./storage";
import { DEFAULT_STATE, type AplyerState } from "./types";

export function useAplyerStore() {
  const [state, setState] = useState<AplyerState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const s = await storage.getState();
    setState(s);
    setLoaded(true);
    return s;
  }, []);

  useEffect(() => {
    let alive = true;
    storage.getState().then((s) => {
      if (alive) {
        setState(s);
        setLoaded(true);
      }
    });
    const unsub = storage.subscribe((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const update = useCallback(async (patch: Partial<AplyerState>) => {
    const next = await storage.patch(patch);
    setState(next);
    return next;
  }, []);

  const reset = useCallback(async () => {
    await storage.reset();
    setState(DEFAULT_STATE);
  }, []);

  return { state, loaded, update, reset, reload };
}
