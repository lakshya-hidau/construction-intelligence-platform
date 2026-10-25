import { Check, Loader2 } from 'lucide-react';

/**
 * A three-step wizard shell used by the photo-based modules.
 *
 * Deliberately dumb: it owns no state beyond presentation. The parent drives `current`
 * (1-based) so the flow can auto-advance when an upload or an analysis completes.
 */
export function Stepper({ steps, current, onJump }) {
  return (
    <div>
    <ol className="flex w-full items-center gap-1.5 sm:gap-3">
      {steps.map((step, index) => {
        const number = index + 1;
        const done = number < current;
        const active = number === current;
        const clickable = done && typeof onJump === 'function';

        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump(number)}
              aria-current={active ? 'step' : undefined}
              className={`group flex min-w-0 flex-1 items-center justify-center gap-2.5 rounded-xl border px-2 py-2.5 text-left transition sm:justify-start sm:px-3 ${
                active
                  ? 'border-accent-200 bg-accent-50/70 shadow-sm'
                  : done
                    ? 'border-slate-200 bg-white hover:border-accent-200 hover:bg-accent-50/40'
                    : 'border-slate-200 bg-white/60'
              } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold transition ${
                  active
                    ? 'bg-accent-600 text-white shadow-sm'
                    : done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? <Check size={13} strokeWidth={3} /> : number}
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-[11px] font-semibold leading-tight sm:hidden ${
                    active ? 'text-accent-900' : done ? 'text-slate-700' : 'text-slate-400'
                  }`}
                >
                  {step.short || step.label}
                </span>
                <span className="hidden sm:block">
                  <span
                    className={`block truncate text-[12px] font-semibold leading-tight ${
                      active ? 'text-accent-900' : done ? 'text-slate-700' : 'text-slate-400'
                    }`}
                  >
                    {step.label}
                  </span>
                  <span className="hidden truncate text-[10.5px] leading-tight text-slate-400 sm:block">
                    {step.hint}
                  </span>
                </span>
              </span>
            </button>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={`hidden h-px w-4 shrink-0 sm:block ${done ? 'bg-emerald-300' : 'bg-slate-200'}`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>

    </div>
  );
}

/** Panel wrapper that gives each wizard step a consistent, quiet frame. */
export function StepPanel({ title, description, children, aside = null, className = '' }) {
  return (
    <section
      className={`animate-fade-up rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-7 ${className}`}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-500">{description}</p>
          ) : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

const CHECKING_MESSAGES = [
  'Reading the photo…',
  'Looking for people and safety gear…',
  'Checking for hazards…',
  'Writing your advice…',
];

/**
 * The "AI Quick Check" state. A checklist that fills in as time passes gives the user a
 * sense of progress and, more importantly, tells them what the system is actually doing —
 * which is the difference between a spinner and a trustworthy tool.
 */
export function CheckingPanel({ message, submessage, tick = 0 }) {
  const activeIndex = Math.min(Math.floor(tick / 1.1), CHECKING_MESSAGES.length - 1);

  return (
    <div className="animate-fade-up rounded-2xl border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
      <div className="flex items-center gap-4">
        <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-50">
          <Loader2 size={22} className="animate-spin text-accent-600" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{message || 'Checking your photo…'}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
            {submessage || 'This usually takes a few seconds.'}
          </p>
        </div>
      </div>

      <ul className="mt-6 space-y-2.5">
        {CHECKING_MESSAGES.map((label, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li key={label} className="flex items-center gap-2.5">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold transition ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : active
                      ? 'bg-accent-100 text-accent-700 ring-2 ring-accent-200'
                      : 'bg-slate-100 text-slate-300'
                }`}
              >
                {done ? <Check size={11} strokeWidth={3} /> : active ? <Loader2 size={10} className="animate-spin" /> : index + 1}
              </span>
              <span
                className={`text-[12.5px] transition ${
                  done ? 'text-slate-500' : active ? 'font-medium text-slate-900' : 'text-slate-400'
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
