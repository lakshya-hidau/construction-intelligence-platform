/**
 * Small, dependency-free design-system primitives.
 * Deliberately plain JSX + Tailwind so the whole app has one visual language.
 */

import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react';
import { permitStyle, severityStyle } from '../../lib/format';

/* ---------------------------------------------------------------- layout ------- */

export function Card({ className = '', children, ...rest }) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-card ${className}`}
      {...rest}
    >
      {children}
    </section>
  );
}

export function CardHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100">
            <Icon size={17} strokeWidth={2} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-snug tracking-tight text-slate-900 sm:truncate">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, hint }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-500">{children}</h3>
      {hint ? <span className="font-mono text-[10px] text-slate-400">{hint}</span> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- buttons ------ */

const BUTTON_VARIANTS = {
  primary:
    'bg-accent-600 text-white hover:bg-accent-700 focus-visible:outline-accent-600 shadow-sm disabled:bg-slate-300 disabled:text-slate-500',
  secondary:
    'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400 disabled:text-slate-400',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:outline-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600 disabled:bg-red-300',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  children,
  className = '',
  disabled,
  ...rest
}) {
  const sizes = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-10 px-4 text-sm gap-2',
    lg: 'h-11 px-5 text-sm gap-2',
  };
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-medium transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2 size={15} className="animate-spin" />
      ) : Icon ? (
        <Icon size={15} strokeWidth={2.1} />
      ) : null}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- badges ------- */

export function Badge({ tone = 'slate', children, icon: Icon, className = '' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    blue: 'bg-accent-50 text-accent-700 ring-accent-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone] || tones.slate} ${className}`}
    >
      {Icon ? <Icon size={11} strokeWidth={2.4} /> : null}
      {children}
    </span>
  );
}

export function SeverityPill({ value, className = '' }) {
  const s = severityStyle(value);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${s.bg} ${s.text} ${s.border} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function PermitPill({ value, className = '' }) {
  const s = permitStyle(value);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset ${s.bg} ${s.text} ${s.border} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/* ---------------------------------------------------------------- feedback ----- */

export function Spinner({ label = 'Working…', className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 text-sm text-slate-500 ${className}`}>
      <Loader2 size={16} className="animate-spin text-accent-600" />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonBlock({ lines = 3 }) {
  return (
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="relative h-3 overflow-hidden rounded bg-slate-100"
          style={{ width: `${100 - i * 12}%` }}
        >
          <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/80 to-transparent" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact = false }) {
  if (!error) return null;
  return (
    <div className={`rounded-lg border border-red-200 bg-red-50 ${compact ? 'p-3' : 'p-4'}`} role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-800">{error.message}</p>
          {error.hint ? <p className="mt-1 text-xs leading-relaxed text-red-700">{error.hint}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-[10px] text-red-600/80">
            <span>{error.code}</span>
            {error.status ? <span>HTTP {error.status}</span> : null}
            {error.requestId ? <span>rid {String(error.requestId).slice(0, 12)}</span> : null}
          </div>
        </div>
        {onRetry && error.retryable !== false ? (
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-100 text-slate-400">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-slate-700">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }) {
  const tones = {
    info: { wrap: 'border-accent-200 bg-accent-50', icon: Info, color: 'text-accent-700' },
    success: { wrap: 'border-emerald-200 bg-emerald-50', icon: CheckCircle2, color: 'text-emerald-700' },
    warning: { wrap: 'border-amber-200 bg-amber-50', icon: AlertTriangle, color: 'text-amber-700' },
    danger: { wrap: 'border-red-200 bg-red-50', icon: AlertTriangle, color: 'text-red-700' },
  }[tone];
  const Icon = tones.icon;
  return (
    <div className={`rounded-lg border p-3.5 ${tones.wrap}`}>
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${tones.color}`} />
        <div className="min-w-0">
          {title ? <p className={`text-sm font-semibold ${tones.color}`}>{title}</p> : null}
          <div className="mt-0.5 text-xs leading-relaxed text-slate-700">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- metrics ------ */

export function StatTile({ label, value, sub, tone = 'slate', icon: Icon, className = '' }) {
  const tones = {
    slate: 'text-slate-900',
    blue: 'text-accent-700',
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  };
  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50/60 p-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</span>
        {Icon ? <Icon size={13} className="text-slate-400" /> : null}
      </div>
      <p className={`mt-1.5 font-mono text-lg font-semibold leading-none tracking-tight ${tones[tone]}`}>{value}</p>
      {sub ? <p className="mt-1 text-[11px] leading-snug text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function Meter({ value, max = 100, color, label, caption, height = 'h-2' }) {
  const pctWidth = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  return (
    <div>
      {(label || caption) && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-slate-600">{label}</span>
          <span className="font-mono text-[11px] text-slate-500">{caption}</span>
        </div>
      )}
      <div className={`w-full overflow-hidden rounded-full bg-slate-200 ${height}`}>
        <div
          className={`${height} rounded-full transition-[width] duration-700 ease-out`}
          style={{ width: `${pctWidth}%`, backgroundColor: color || '#2563eb' }}
        />
      </div>
    </div>
  );
}

export function RadialGauge({ value, size = 108, stroke = 9, color = '#2563eb', label, sublabel }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const dash = (clamped / 100) * c;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="font-mono text-xl font-semibold leading-none text-slate-900">{label ?? Math.round(clamped)}</span>
        {sublabel ? (
          <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">{sublabel}</span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- forms -------- */

export function Field({ label, hint, error, required, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-700">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </span>
        {hint ? <span className="font-mono text-[10px] text-slate-400">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-[11px] text-red-600">{error}</span> : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 disabled:bg-slate-50 disabled:text-slate-400';

export function TextInput({ className = '', ...rest }) {
  return <input className={`${CONTROL} h-10 ${className}`} {...rest} />;
}

export function TextArea({ className = '', rows = 3, ...rest }) {
  return <textarea rows={rows} className={`${CONTROL} py-2 leading-relaxed ${className}`} {...rest} />;
}

export function Select({ className = '', options = [], placeholder, ...rest }) {
  return (
    <div className="relative">
      <select className={`${CONTROL} h-10 appearance-none pr-9 ${className}`} {...rest}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path d="M5.25 7.5 10 12.25 14.75 7.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function Toggle({ checked, onChange, options, ariaLabel }) {
  return (
    <div
      className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-slate-200"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = checked === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? 'border-accent-300 bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 ring-1 ring-inset ring-slate-200">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {Icon ? <Icon size={13} strokeWidth={2.2} /> : null}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- disclosure --- */

export function EngineFooter({ engine }) {
  if (!engine) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 pt-3 font-mono text-[10px] text-slate-400">
      <span className="font-semibold uppercase tracking-wide text-slate-500">{engine.engine_mode}</span>
      <span>·</span>
      <span>{engine.provider}/{engine.model}</span>
      <span>·</span>
      <span>{engine.latency_ms}ms</span>
      <span>·</span>
      <span>conf {(engine.confidence * 100).toFixed(0)}%</span>
      <span>·</span>
      <span>rid {String(engine.request_id).slice(0, 10)}</span>
      <p className="mt-1 w-full text-[10px] leading-relaxed text-slate-400">{engine.disclosure}</p>
    </div>
  );
}
