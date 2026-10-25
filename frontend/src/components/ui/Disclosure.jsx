import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Collapsible section used to keep Simple View uncluttered while leaving the detailed
 * data one tap away. Uses a button + region pair (not <details>) so the chevron and the
 * height transition stay consistent with the rest of the design system.
 */
export default function Disclosure({
  title,
  subtitle,
  badge,
  children,
  defaultOpen = false,
  variant = 'card',
  className = '',
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const buttonId = useId();

  const shell =
    variant === 'plain'
      ? 'border border-slate-200 bg-white'
      : 'border border-slate-200 bg-white shadow-soft';

  return (
    <div className={`overflow-hidden rounded-2xl transition-shadow ${shell} ${className}`}>
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50/80 focus:outline-none focus-visible:bg-slate-50"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-slate-900">{title}</span>
            {badge}
          </span>
          {subtitle ? (
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">{subtitle}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-400">
          <span className="hidden sm:inline">{open ? 'Hide' : 'View'}</span>
          <ChevronDown
            size={16}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="animate-fade-up border-t border-slate-100 px-5 py-5"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
