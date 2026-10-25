import {
  Bot,
  Calculator,
  CloudSun,
  HardHat,
  LayoutDashboard,
  ScanLine,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useViewMode } from '../lib/viewMode';

/**
 * Module navigation.
 *
 * Each module carries two labels: a plain one for Simple View ("Check site safety") and a
 * professional one for Expert View ("Safety Monitor"). Same destination, different mental
 * model — a site owner is looking for a task, an engineer is looking for a module.
 */
export const MODULES = [
  {
    id: 'overview',
    label: 'Overview',
    simpleLabel: 'Home',
    icon: LayoutDashboard,
    blurb: 'Portfolio and engine status',
    simpleBlurb: 'Start here',
    group: 'Workspace',
  },
  {
    id: 'safety',
    label: 'Safety Monitor',
    simpleLabel: 'Check site safety',
    icon: ShieldCheck,
    blurb: 'PPE & hazard audit',
    simpleBlurb: 'Are workers safe?',
    group: 'Vision modules',
    simpleGroup: 'Photo checks',
  },
  {
    id: 'crack',
    label: 'Crack Analyzer',
    simpleLabel: 'Check for cracks',
    icon: ScanLine,
    blurb: 'Structural diagnostics',
    simpleBlurb: 'Is this crack serious?',
    group: 'Vision modules',
    simpleGroup: 'Photo checks',
  },
  {
    id: 'valuation',
    label: 'Valuation & Planning',
    simpleLabel: 'Property value & timeline',
    icon: Calculator,
    blurb: 'Pricing and CPM schedules',
    simpleBlurb: 'What is it worth?',
    group: 'Commercial',
    simpleGroup: 'Money & time',
  },
  {
    id: 'weather',
    label: 'Weather Advisory',
    simpleLabel: 'Is it safe to work today?',
    icon: CloudSun,
    blurb: 'Permit status & work windows',
    simpleBlurb: 'Weather and work',
    group: 'Field operations',
    simpleGroup: 'Help & advice',
  },
  {
    id: 'assistant',
    label: 'Knowledge Assistant',
    simpleLabel: 'Ask a question',
    icon: Bot,
    blurb: 'RAG over standards corpus',
    simpleBlurb: 'Get plain answers',
    group: 'Field operations',
    simpleGroup: 'Help & advice',
  },
];

export default function Sidebar({ active, onNavigate, open, onClose, health, offline }) {
  const { isExpert } = useViewMode();

  const groups = MODULES.reduce((acc, module) => {
    const groupName = isExpert ? module.group : module.simpleGroup || module.group;
    (acc[groupName] ||= []).push(module);
    return acc;
  }, {});

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-ink-950/50 transition-opacity lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[254px] shrink-0 flex-col bg-ink-900 transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-600 text-white">
            <HardHat size={17} strokeWidth={2.1} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold leading-tight text-white">
              {isExpert ? 'CIP Console' : 'Site Companion'}
            </p>
            <p className="truncate text-[10px] leading-tight text-slate-400">
              {isExpert ? 'Site intelligence suite' : 'Simple checks in plain English'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X size={15} />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p className="px-2 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {group}
              </p>
              <ul className="space-y-0.5">
                {items.map((module) => {
                  const Icon = module.icon;
                  const isActive = active === module.id;
                  return (
                    <li key={module.id}>
                      <button
                        type="button"
                        data-module={module.id}
                        onClick={() => onNavigate(module.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                          isActive
                            ? 'bg-accent-600 text-white shadow-sm'
                            : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'
                        }`}
                      >
                        <Icon
                          size={16}
                          strokeWidth={2.1}
                          className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-accent-300'}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium leading-tight">
                            {isExpert ? module.label : module.simpleLabel}
                          </span>
                          <span
                            className={`block truncate text-[10px] leading-tight ${
                              isActive ? 'text-accent-100' : 'text-slate-500'
                            }`}
                          >
                            {isExpert ? module.blurb : module.simpleBlurb}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          {isExpert ? (
            <div className="rounded-lg bg-white/[0.04] p-2.5">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${offline ? 'bg-red-400' : 'bg-emerald-400'}`} />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {offline ? 'Backend offline' : 'Backend healthy'}
                </p>
              </div>
              <p className="mt-1 font-mono text-[9.5px] leading-relaxed text-slate-500">
                {health ? `${health.provider}/${health.model}` : 'probing…'}
                <br />
                {health ? `${health.knowledge_chunks} KB chunks · wx: ${health.weather_provider}` : '—'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-white/[0.04] p-2.5">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${offline ? 'bg-red-400' : 'bg-emerald-400'}`} />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {offline ? 'Not connected' : 'Ready to help'}
                </p>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                {offline ? 'Ask your manager to start the system.' : 'Take a photo and tap check.'}
              </p>
            </div>
          )}
          <p className="mt-2 px-1 text-[9px] leading-relaxed text-slate-600">
            Guidance only — still confirm with a qualified person on site.
          </p>
        </div>
      </aside>
    </>
  );
}
