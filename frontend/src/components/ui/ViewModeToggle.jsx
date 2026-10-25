import { useEffect, useState } from 'react';
import { SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useViewMode } from '../../lib/viewMode';

const HINT_KEY = 'cip.viewMode.hinted';

/**
 * First-run hint. A mode toggle that nobody notices is a mode nobody uses, so on the very
 * first visit (Simple View only) we show one short explanation with a dismiss action.
 * Dismissal is remembered, and it never appears in Expert View.
 */
function useFirstRunHint() {
  const { isSimple } = useViewMode();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isSimple) {
      setVisible(false);
      return;
    }
    try {
      if (localStorage.getItem(HINT_KEY) === '1') return;
    } catch {
      return;
    }
    const show = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(show);
  }, [isSimple]);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* private mode — the hint simply reappears next visit */
    }
  };

  return { visible: visible && isSimple, dismiss };
}

/**
 * Segmented Simple / Expert switch.
 *
 * The sliding pill is one element translated by 100% of its own width, which lands it
 * exactly on the second segment because the pill and the segments are the same width.
 * That keeps the animation at 60fps (transform only) instead of animating layout.
 */
export default function ViewModeToggle({ compact = false }) {
  const { setMode, isExpert } = useViewMode();
  const { visible, dismiss } = useFirstRunHint();

  return (
    <div className="relative flex items-center gap-2">
      <div
        role="group"
        aria-label="View mode"
        className="relative flex rounded-full bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/80"
      >
        <span
          aria-hidden
          className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-sm ring-1 ring-slate-900/5 transition-transform duration-300 ease-out ${
            isExpert ? 'translate-x-full' : 'translate-x-0'
          }`}
        />
        <button
          type="button"
          onClick={() => setMode('simple')}
          aria-pressed={!isExpert}
          title="Plain language, large actions, no technical detail"
          className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
            compact ? 'w-9' : 'w-9 sm:w-[92px]'
          } ${!isExpert ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Sparkles size={13} strokeWidth={2.3} className={!isExpert ? 'text-accent-600' : ''} />
          {compact ? null : <span className="hidden whitespace-nowrap sm:inline">Simple View</span>}
        </button>
        <button
          type="button"
          onClick={() => {
            dismiss();
            setMode('expert');
          }}
          aria-pressed={isExpert}
          title="Full metrics, confidence scores and standard references"
          className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
            compact ? 'w-9' : 'w-9 sm:w-[92px]'
          } ${isExpert ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <SlidersHorizontal size={13} strokeWidth={2.3} className={isExpert ? 'text-accent-600' : ''} />
          {compact ? null : <span className="hidden whitespace-nowrap sm:inline">Expert Mode</span>}
        </button>
      </div>

      {visible ? (
        <div className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lift">
          <span
            aria-hidden
            className="absolute -top-1.5 right-16 h-3 w-3 rotate-45 border-l border-t border-slate-200 bg-white"
          />
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss tip"
            className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-slate-100"
          >
            <X size={11} />
          </button>
          <p className="pr-5 text-[12px] font-semibold text-slate-900">Reading this in Simple View</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
            Plain-language answers and big actions. Switch to <strong>Expert Mode</strong> any time
            for measurements, confidence scores and code references — your results stay as they are.
          </p>
        </div>
      ) : null}

    </div>
  );
}

/**
 * Renders children only in Expert View. `hint` shows a quiet affordance in Simple View so
 * the detailed data is discoverable rather than feeling deliberately hidden.
 */
export function ExpertOnly({ children, hint = null, className = '' }) {
  const { isExpert } = useViewMode();
  if (isExpert) return children;
  if (!hint) return null;
  return (
    <p className={`text-[11px] leading-relaxed text-slate-400 ${className}`}>
      {hint}{' '}
      <SwitchLink>Switch to Expert View</SwitchLink> to see it.
    </p>
  );
}

export function SimpleOnly({ children }) {
  const { isSimple } = useViewMode();
  return isSimple ? children : null;
}

export function SwitchLink({ children }) {
  const { setMode } = useViewMode();
  return (
    <button
      type="button"
      onClick={() => setMode('expert')}
      className="font-medium text-accent-700 underline decoration-accent-300 decoration-dotted underline-offset-2 hover:text-accent-800"
    >
      {children}
    </button>
  );
}
