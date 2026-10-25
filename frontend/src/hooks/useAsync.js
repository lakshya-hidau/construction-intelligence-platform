/** Minimal async-state hooks. No external state library needed for this app. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * Wraps an async action with loading/error/data state plus request de-duplication.
 * @returns {{ data, error, loading, progress, run, reset, setData }}
 */
export function useAsyncAction(action, { onProgress = false } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: false, progress: 0 });
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args) => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setState((s) => ({ ...s, loading: true, error: null, progress: 0 }));
      try {
        const data = await action(
          ...args,
          onProgress
            ? (pct) => {
                if (mounted.current) setState((s) => ({ ...s, progress: pct }));
              }
            : undefined,
        );
        if (mounted.current) setState({ data, error: null, loading: false, progress: 100 });
        return data;
      } catch (error) {
        if (mounted.current) setState((s) => ({ ...s, error, loading: false, progress: 0 }));
        return undefined;
      } finally {
        inFlight.current = false;
      }
    },
    [action, onProgress],
  );

  const reset = useCallback(
    () => setState({ data: null, error: null, loading: false, progress: 0 }),
    [],
  );

  return { ...state, run, reset, setData: (data) => setState((s) => ({ ...s, data })) };
}

/** Polls /health so the shell can show live backend capability. */
export function useBackendHealth(intervalMs = 30_000) {
  const [health, setHealth] = useState(null);
  const [offline, setOffline] = useState(false);

  const probe = useCallback(async () => {
    try {
      const data = await api.health();
      setHealth(data);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await probe();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [probe, intervalMs]);

  return { health, offline, refresh: probe };
}

/** Loads the curated sample catalogue once, filtered to the calling module. */
export function useSamples(moduleName) {
  const [samples, setSamples] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api
      .samples()
      .then((list) => {
        if (!cancelled) setSamples(list.filter((s) => s.module === moduleName));
      })
      .catch(() => {
        // Samples are a convenience; their absence must never block the module.
      });
    return () => {
      cancelled = true;
    };
  }, [moduleName]);
  return samples;
}

/** Creates and revokes an object URL for a File. */
export function useObjectUrl(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
