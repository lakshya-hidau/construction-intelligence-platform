import { Activity, BookOpen, Cpu, Menu, Radio, WifiOff } from 'lucide-react';
import ViewModeToggle, { ExpertOnly } from './ui/ViewModeToggle';
import { useViewMode } from '../lib/viewMode';

/**
 * Top bar. In Simple View it deliberately shows very little: a title, the mode toggle
 * and a single connection indicator. Engine provenance, KB counts and API links are
 * expert affordances and are gated accordingly.
 */
export default function Navbar({ health, offline, onToggleSidebar, activeModule }) {
  const { isExpert } = useViewMode();
  const llm = health?.engine_mode === 'llm';

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-md lg:px-6">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 lg:hidden"
        aria-label="Toggle navigation"
      >
        <Menu size={18} />
      </button>

      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-900 text-white shadow-sm">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
            <path d="M3 21V9l6-4v3l6-4v6h6v11H3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M7 21v-4h3v4M14 21v-5h3v5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight tracking-tight text-slate-900">
            <span className="sm:hidden">{isExpert ? 'CIP Console' : 'Site Companion'}</span>
            <span className="hidden sm:inline">Construction Intelligence</span>
          </h1>
          <p className="hidden truncate text-[11px] leading-tight text-slate-500 sm:block">
            {isExpert ? activeModule?.label || 'Expert workspace' : 'Easy site checks'}
          </p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* The toggle is the only global control a Simple View user needs. */}
        <ViewModeToggle compact={false} />

        <span className="hidden h-6 w-px bg-slate-200 sm:block" />

        {isExpert ? (
          <>
            <span
              className={`hidden items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset md:inline-flex ${
                offline
                  ? 'bg-red-50 text-red-700 ring-red-200'
                  : llm
                    ? 'bg-violet-50 text-violet-700 ring-violet-200'
                    : 'bg-accent-50 text-accent-700 ring-accent-200'
              }`}
            >
              {offline ? <WifiOff size={11} /> : llm ? <Cpu size={11} /> : <Radio size={11} />}
              {offline ? 'API offline' : llm ? `LLM · ${health.provider}` : 'Heuristic engine'}
            </span>

            {health ? (
              <span className="hidden items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 lg:inline-flex">
                <Activity size={11} />
                {health.knowledge_chunks} docs
              </span>
            ) : null}

            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 md:inline-flex"
            >
              <BookOpen size={14} />
              API docs
            </a>
          </>
        ) : null}

        {/* Connection dot stays in both modes: "is this thing working?" matters to everyone. */}
        <span
          className={`relative grid h-8 w-8 place-items-center rounded-full ring-1 ${
            offline ? 'bg-red-50 ring-red-200' : 'bg-emerald-50 ring-emerald-200'
          }`}
          title={offline ? 'Cannot reach the server' : 'Connected'}
        >
          <span
            className={`h-2 w-2 rounded-full ${offline ? 'bg-red-500' : 'animate-pulse-ring bg-emerald-500'}`}
          />
        </span>
      </div>
    </header>
  );
}

export { ExpertOnly };
