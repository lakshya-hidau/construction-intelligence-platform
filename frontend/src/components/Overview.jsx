import {
  ArrowRight,
  Bot,
  Calculator,
  CheckCircle2,
  CloudSun,
  Cpu,
  Database,
  Radar,
  ScanLine,
  Server,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { Badge, Card, CardHeader, Notice, StatTile } from './ui/Primitives';
import { MODULES } from './Sidebar';
import { titleCase } from '../lib/format';
import { useViewMode } from '../lib/viewMode';

const MODULE_META = {
  safety: {
    icon: ShieldCheck,
    tone: 'from-accent-600 to-accent-800',
    title: 'Safety Monitor',
    body: 'Upload a site frame and get a PPE compliance index, a severity-ranked hazard register with bounding boxes, and a corrective action plan citing OSHA / IS standards.',
    capabilities: ['Helmet, vest & harness screening', 'Fall & edge exposure', 'Stop-work escalation'],
  },
  crack: {
    icon: ScanLine,
    tone: 'from-slate-700 to-slate-900',
    title: 'Crack Analyzer',
    body: 'Classify crack pattern and grade severity against ACI 224 / IS 456 width banding, with remediation method statements and a monitoring plan.',
    capabilities: ['Width classification', 'Shear vs shrinkage diagnosis', 'Epoxy / jacketing guidance'],
  },
  valuation: {
    icon: Calculator,
    tone: 'from-emerald-600 to-emerald-800',
    title: 'Valuation & Planning',
    body: 'Hedonic valuation with every adjustment itemised, plus CPM-based programme generation with milestones, phase tasks, resources and risks.',
    capabilities: ['Itemised value drivers', 'Dated milestone schedule', 'Resource & risk roll-up'],
  },
  weather: {
    icon: CloudSun,
    tone: 'from-sky-500 to-sky-700',
    title: 'Weather Advisory',
    body: 'Live conditions converted into a permit status, activity-specific controls and work windows — concrete placement limits, heat stress, wind and lightning.',
    capabilities: ['Go / caution / hold permit', 'Heat-stress (WBGT) banding', '7-day workability'],
  },
  assistant: {
    icon: Bot,
    tone: 'from-violet-600 to-violet-800',
    title: 'Knowledge Assistant',
    body: 'RAG over a curated corpus of IS, ACI, OSHA, NBC and RERA extracts. Every answer is cited, and out-of-scope questions are refused rather than guessed.',
    capabilities: ['Hybrid BM25 retrieval', 'Inline citations', 'Refuses off-domain queries'],
  },
};

export default function Overview({ health, offline, onNavigate }) {
  const llm = health?.engine_mode === 'llm';
  const { isSimple } = useViewMode();

  if (isSimple) return <SimpleOverview health={health} offline={offline} onNavigate={onNavigate} />;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="relative bg-ink-900 px-6 py-7">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
              backgroundSize: '38px 38px',
            }}
          />
          <div className="relative max-w-3xl">
            <Badge tone="blue" className="!bg-white/10 !text-accent-200 !ring-white/20">
              Decision support · multimodal
            </Badge>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
              One console for site safety, structural health, value and programme risk.
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-300">
              Five modules wrap a vision-capable AI layer behind strict, versioned JSON contracts. Every result
              discloses which engine produced it and carries a confidence score — so a heuristic screening is never
              mistaken for a certified inspection.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('safety')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-ink-900 transition hover:bg-slate-100"
              >
                Run a safety audit <ArrowRight size={13} />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('assistant')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
              >
                Ask the assistant <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      </Card>

      {offline ? (
        <Notice tone="danger" title="Backend unreachable">
          The API server isn’t responding. Start it with{' '}
          <code className="rounded bg-white px-1 font-mono text-[11px]">uvicorn main:app --reload</code> from the{' '}
          <code className="rounded bg-white px-1 font-mono text-[11px]">backend/</code> directory. Modules will show an
          error until the connection is restored.
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Engine mode"
          value={offline ? 'Offline' : llm ? 'LLM' : 'Heuristic'}
          sub={health ? `${health.provider} / ${health.model}` : 'probing…'}
          icon={Cpu}
          tone={llm ? 'blue' : 'slate'}
        />
        <StatTile
          label="Vision capability"
          value={health?.vision_enabled ? 'Enabled' : 'Local CV'}
          sub={health?.vision_enabled ? 'multimodal model bound' : 'deterministic fallback'}
          icon={Radar}
        />
        <StatTile
          label="Knowledge base"
          value={health ? `${health.knowledge_chunks}` : '—'}
          sub="indexed standards chunks"
          icon={Database}
        />
        <StatTile
          label="Uptime"
          value={health ? `${Math.floor(health.uptime_seconds / 60)}m` : '—'}
          sub={health ? `v${health.version}` : '—'}
          icon={health && !offline ? CheckCircle2 : WifiOff}
          tone={offline ? 'red' : 'green'}
        />
      </div>

      <div>
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-500">Modules</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(MODULE_META).map(([id, meta]) => {
            const Icon = meta.icon;
            const mod = MODULES.find((m) => m.id === id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white text-left shadow-card transition hover:-translate-y-0.5 hover:border-accent-300 hover:shadow-panel"
              >
                <div className={`flex items-center gap-2.5 rounded-t-xl bg-gradient-to-br ${meta.tone} px-4 py-3.5`}>
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 text-white ring-1 ring-inset ring-white/25">
                    <Icon size={16} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-white">{meta.title}</p>
                    <p className="truncate text-[10px] text-white/70">{mod?.blurb}</p>
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-[12px] leading-relaxed text-slate-600">{meta.body}</p>
                  <ul className="mt-3 space-y-1.5">
                    {meta.capabilities.map((cap) => (
                      <li key={cap} className="flex items-start gap-1.5 text-[11px] text-slate-500">
                        <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-emerald-500" />
                        {cap}
                      </li>
                    ))}
                  </ul>
                  <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[11px] font-semibold text-accent-700 group-hover:gap-2">
                    Open module <ArrowRight size={12} className="transition-all" />
                  </span>
                </div>
              </button>
            );
          })}

          <Card className="flex flex-col">
            <CardHeader icon={Server} title="System contract" subtitle="Machine-readable schema" />
            <div className="flex flex-1 flex-col p-4">
              <p className="text-[12px] leading-relaxed text-slate-600">
                Every endpoint is declared with an explicit Pydantic model. Consumers can introspect the live
                contract at <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">/api/contracts</code>{' '}
                and the enumerations at{' '}
                <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">/api/options</code>.
              </p>
              <dl className="mt-3 space-y-1.5 font-mono text-[10.5px]">
                {[
                  ['POST', '/api/analysis/safety'],
                  ['POST', '/api/analysis/crack'],
                  ['POST', '/api/valuation'],
                  ['POST', '/api/plan'],
                  ['GET ', '/api/weather/advisory'],
                  ['POST', '/api/assistant/chat'],
                ].map(([method, path]) => (
                  <div key={path} className="flex items-center gap-2">
                    <span
                      className={`w-9 shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold ${
                        method.trim() === 'GET' ? 'bg-emerald-50 text-emerald-700' : 'bg-accent-50 text-accent-700'
                      }`}
                    >
                      {method.trim()}
                    </span>
                    <span className="truncate text-slate-500">{path}</span>
                  </div>
                ))}
              </dl>
              <div className="mt-auto pt-4">
                <Badge tone={offline ? 'red' : 'green'} icon={offline ? WifiOff : CheckCircle2}>
                  {offline ? 'Disconnected' : `Healthy · ${titleCase(health?.weather_provider || '')}`}
                </Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Notice tone="warning" title="Scope of this system">
        These modules are decision-support tools. They are not a substitute for a competent person’s inspection, a
        licensed structural engineer’s assessment, or a registered valuer’s report. Always verify in the field and
        against the current edition of the cited standard before instructing works or transacting.
      </Notice>
    </div>
  );
}

/* ============================================================== SIMPLE VIEW === */

const SIMPLE_TASKS = [
  {
    id: 'safety',
    icon: ShieldCheck,
    title: 'Check site safety',
    body: 'Take a photo of the work area. We tell you if anyone is missing protective gear.',
    cta: 'Check a photo',
    chip: 'bg-emerald-50 text-emerald-700',
  },
  {
    id: 'crack',
    icon: ScanLine,
    title: 'Check for cracks',
    body: 'Photograph a crack in a wall, slab or column. We say how serious it is.',
    cta: 'Check a crack',
    chip: 'bg-amber-50 text-amber-700',
  },
  {
    id: 'valuation',
    icon: Calculator,
    title: 'Property value & timeline',
    body: 'Find out what a property is worth, or how long a project will take to finish.',
    cta: 'Estimate',
    chip: 'bg-sky-50 text-sky-700',
  },
  {
    id: 'weather',
    icon: CloudSun,
    title: 'Is it safe to work today?',
    body: 'Today’s weather for your site, and whether it is right for concrete, digging or painting.',
    cta: 'Check the weather',
    chip: 'bg-indigo-50 text-indigo-700',
  },
];

/**
 * Home screen for non-technical users: four large, self-explanatory tasks and a place to
 * ask a question. No engine metrics, no endpoint list, no capability matrices.
 */
function SimpleOverview({ health, offline, onNavigate }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div className="px-6 py-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-accent-600">
            {greeting}
          </p>
          <h1 className="mt-1.5 text-[22px] font-bold leading-tight tracking-tight text-slate-900 sm:text-2xl">
            What would you like to check?
          </h1>
          <p className="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-slate-500">
            Take a photo or answer a couple of questions. You will get a clear answer and the next step — no
            technical terms.
          </p>

          <button
            type="button"
            onClick={() => onNavigate('assistant')}
            className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-left transition hover:border-accent-300 hover:bg-accent-50/60"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-900 text-white">
              <Bot size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-slate-900">Ask a question</span>
              <span className="block text-[11.5px] text-slate-500">
                Curing times, safety gear, building rules…
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-slate-400" />
          </button>
        </div>
      </section>

      {offline ? (
        <Notice tone="danger" title="The system is not reachable">
          Checks will not work until it is back online. Try again in a moment, or ask your site manager to restart it.
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {SIMPLE_TASKS.map((task) => {
          const Icon = task.icon;
          return (
            <button
              key={task.id}
              type="button"
              data-module={task.id}
              onClick={() => onNavigate(task.id)}
              className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-accent-200 hover:shadow-lift"
            >
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${task.chip}`}>
                <Icon size={20} strokeWidth={2.1} />
              </span>
              <p className="mt-3.5 text-[15px] font-semibold leading-tight text-slate-900">{task.title}</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{task.body}</p>
              <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[12px] font-semibold text-accent-700">
                {task.cta}
                <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          );
        })}
      </div>

      <p className="px-1 text-center text-[11.5px] leading-relaxed text-slate-400">
        Everything here is guidance to help you decide — it does not replace a qualified engineer or safety
        officer on site.
        {health ? ` System ready · v${health.version}` : ''}
      </p>
    </div>
  );
}
