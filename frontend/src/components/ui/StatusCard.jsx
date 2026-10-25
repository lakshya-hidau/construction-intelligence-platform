import { CheckCircle2, ShieldAlert, TriangleAlert, OctagonAlert } from 'lucide-react';
import { TONES } from '../../lib/plainEnglish';

const ICONS = {
  ok: CheckCircle2,
  warning: TriangleAlert,
  stop: OctagonAlert,
  alert: ShieldAlert,
};

/**
 * The single most important element on a Simple View screen: one large, colour-coded
 * verdict with a plain-English sentence and at most one primary action.
 *
 * Everything that competes with this card is either demoted to a fact tile or hidden
 * behind a disclosure, so the answer to "am I okay?" is unambiguous at a glance.
 */
export default function StatusCard({ tone = 'watch', icon = 'warning', eyebrow, headline, detail, meta, action }) {
  const t = TONES[tone] || TONES.watch;
  const Icon = ICONS[icon] || TriangleAlert;

  return (
    <div className={`overflow-hidden rounded-2xl border p-5 shadow-soft sm:p-7 ${t.card}`}>
      <div className="flex items-start gap-4">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-sm ${t.solid}`}>
          <Icon size={24} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[10.5px] font-bold uppercase tracking-[0.11em] ${t.muted}`}>{eyebrow || t.label}</p>
          <h2 className={`mt-1 text-xl font-bold leading-tight tracking-tight sm:text-2xl ${t.text}`}>
            {headline}
          </h2>
          {detail ? (
            <p className={`mt-1.5 max-w-xl text-[13.5px] leading-relaxed ${t.muted}`}>{detail}</p>
          ) : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">{meta}</div> : null}
        </div>
      </div>
      {action ? <div className="mt-5 flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Three-up "at a glance" facts under the status card. */
export function FactGrid({ facts = [] }) {
  if (!facts.length) return null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {facts.map((fact) => {
        const Icon = fact.icon;
        const tone = TONES[fact.tone] || null;
        return (
          <div
            key={fact.label}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-soft sm:p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[9.5px] font-semibold uppercase leading-tight tracking-[0.06em] text-slate-500 sm:text-[10.5px] sm:tracking-[0.08em]">
                {fact.label}
              </span>
              {Icon ? <Icon size={15} className="hidden shrink-0 text-slate-300 sm:block" /> : null}
            </div>
            <p className="mt-2 break-words text-[15px] font-bold leading-tight tracking-tight text-slate-900 sm:text-lg sm:leading-none">
              {fact.value}
            </p>
            {fact.sub ? (
              <p className={`mt-1.5 text-[10.5px] leading-snug sm:text-[11.5px] ${tone ? tone.muted : 'text-slate-500'}`}>
                {fact.sub}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
