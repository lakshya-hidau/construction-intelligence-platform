/**
 * Simple / Expert view-mode state.
 *
 * The whole product has two audiences that need very different densities of information:
 * a site owner who wants "is this safe, and what do I do next?" and an engineer who wants
 * compliance indices, bbox coordinates and clause references. Rather than maintain two
 * apps, every screen branches on a single persisted preference.
 *
 * Default is `simple` — a first-time visitor is far more likely to be non-technical, and
 * an expert can find the toggle in one click.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'cip.viewMode';
const MODES = ['simple', 'expert'];

const noop = () => {};

const ViewModeContext = createContext({
  mode: 'simple',
  isSimple: true,
  isExpert: false,
  setMode: noop,
  toggle: noop,
});

function readStoredMode() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (MODES.includes(stored)) return stored;
  } catch {
    // Safari private mode / storage disabled — fall through to the default.
  }
  return 'simple';
}

export function ViewModeProvider({ children, initialMode }) {
  const [mode, setModeState] = useState(() => MODES.includes(initialMode) ? initialMode : readStoredMode());

  // Expose the mode on <html> so CSS (and our own e2e checks) can react to it.
  useEffect(() => {
    document.documentElement.dataset.viewMode = mode;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Preference simply won't persist; the session still works.
    }
  }, [mode]);

  const setMode = useCallback((next) => {
    if (MODES.includes(next)) setModeState(next);
  }, []);

  const toggle = useCallback(() => {
    setModeState((current) => (current === 'simple' ? 'expert' : 'simple'));
  }, []);

  const value = useMemo(
    () => ({ mode, isSimple: mode === 'simple', isExpert: mode === 'expert', setMode, toggle }),
    [mode, setMode, toggle],
  );

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export const useViewMode = () => useContext(ViewModeContext);

export default ViewModeContext;
