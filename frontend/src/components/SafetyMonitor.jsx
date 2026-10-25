import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ClipboardCheck,
  Footprints,
  Glasses,
  Hand,
  HardHat,
  Info,
  Lightbulb,
  Link as LinkIcon,
  ListChecks,
  MapPin,
  Play,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  Shirt,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAsyncAction, useObjectUrl, useSamples } from '../hooks/useAsync';
import { useViewMode } from '../lib/viewMode';
import { riskRamp, severityStyle, titleCase } from '../lib/format';
import {
  plainRewrite,
  plainSentence,
  scoreLabel,
  scoreTone,
  safetyStatus,
  toneFor,
  ppeSentences,
} from '../lib/plainEnglish';
import ImageDropzone, { BBoxOverlay } from './ui/ImageDropzone';
import StatusCard, { FactGrid } from './ui/StatusCard';
import Disclosure from './ui/Disclosure';
import { CheckingPanel, StepPanel, Stepper } from './ui/Wizard';
import { ExpertOnly, SwitchLink } from './ui/ViewModeToggle';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  EngineFooter,
  ErrorState,
  Field,
  Meter,
  Notice,
  RadialGauge,
  SectionTitle,
  SeverityPill,
  SkeletonBlock,
  StatTile,
  TextArea,
  Toggle,
} from './ui/Primitives';

const SAMPLE_CONTEXT = 'Level 4 — north edge, slab pour preparation';

const WIZARD_STEPS = [
  { id: 'upload', short: 'Photo', label: 'Add a photo', hint: 'From your phone' },
  { id: 'check', short: 'Check', label: 'Quick check', hint: 'We look for hazards' },
  { id: 'advice', short: 'Advice', label: 'What to do', hint: 'Clear next steps' },
];

const PPE_ICON = {
  helmet: HardHat,
  hi_vis_vest: Shirt,
  harness: LinkIcon,
  safety_boots: Footprints,
  eye_protection: Glasses,
  gloves: Hand,
};

export default function SafetyMonitor({ onRequireBackend }) {
  const { isExpert } = useViewMode();
  const samples = useSamples('safety');

  const [file, setFile] = useState(null);
  const [siteContext, setSiteContext] = useState('');
  const [strictness, setStrictness] = useState('standard');
  const [step, setStep] = useState(1);
  const [tick, setTick] = useState(0);

  const previewUrl = useObjectUrl(file);

  const runSafety = useCallback(
    (f, ctx, strictnessValue, onProgress) =>
      api.analyzeSafety(f, { siteContext: ctx, strictness: strictnessValue }, onProgress),
    [],
  );
  const { data, error, loading, progress, run, reset } = useAsyncAction(runSafety, { onProgress: true });

  // Drives the "what we are doing" checklist while the request is in flight.
  useEffect(() => {
    if (!loading) return undefined;
    setTick(0);
    const id = setInterval(() => setTick((value) => value + 1), 700);
    return () => clearInterval(id);
  }, [loading]);

  // `overrideFile` lets the sample chips kick off an audit with the file they just
  // selected — `file` in this closure would still be the previous one (or null).
  const check = useCallback(
    async (overrideFile) => {
      // A click event can reach here through onClick; only accept a real File.
      const target = overrideFile instanceof File ? overrideFile : file;
      if (!target) return;
      setStep(2);
      const result = await run(target, siteContext, strictness);
      if (result) {
        setStep(3);
      } else {
        setStep(1);
        onRequireBackend?.();
      }
    },
    [file, siteContext, strictness, run, onRequireBackend],
  );

  const startOver = () => {
    setFile(null);
    setSiteContext('');
    reset();
    setStep(1);
  };

  const hazards = data?.hazards ?? [];
  const boxes = useMemo(
    () =>
      hazards
        .filter((hazard) => hazard.bbox)
        .map((hazard) => ({ ...hazard.bbox, label: `${hazard.id} · ${titleCase(hazard.severity)}` })),
    [hazards],
  );
  const status = data ? safetyStatus(data) : null;

  /* ------------------------------------------------------------- EXPERT VIEW -- */
  if (isExpert) {
    return (
      <ExpertSafety
        file={file}
        setFile={setFile}
        siteContext={siteContext}
        setSiteContext={setSiteContext}
        strictness={strictness}
        setStrictness={setStrictness}
        previewUrl={previewUrl}
        samples={samples}
        data={data}
        error={error}
        loading={loading}
        progress={progress}
        analyze={check}
        clearAll={startOver}
        boxes={boxes}
        hazards={hazards}
      />
    );
  }

  /* ------------------------------------------------------------- SIMPLE VIEW -- */
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Stepper
        steps={WIZARD_STEPS}
        current={step}
        onJump={(target) => target < step && setStep(target)}
      />

      {step === 1 ? (
        <StepPanel
          title="Add a photo of the site"
          description="A clear photo taken from ground level works best. Make sure the people in the photo are visible."
        >
          <div className="space-y-5">
            <ImageDropzone
              file={file}
              previewUrl={previewUrl}
              onSelect={(next) => {
                setFile(next);
                reset();
              }}
              onClear={startOver}
              disabled={loading}
              label="Site photo"
              samples={samples}
            />

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Lightbulb size={13} className="text-amber-500" /> For a better check
              </p>
              <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-slate-600">
                <li>• Stand back so the whole work area is in the photo.</li>
                <li>• Avoid strong backlight or deep shadows.</li>
                <li>• One area per photo is easier to act on.</li>
              </ul>
            </div>

            <Disclosure title="Add a note (optional)" subtitle="Tell us where this was taken or what is happening.">
              <TextArea
                rows={2}
                value={siteContext}
                maxLength={300}
                onChange={(event) => setSiteContext(event.target.value)}
                placeholder={SAMPLE_CONTEXT}
                disabled={loading}
              />
            </Disclosure>

            {error ? <ErrorState error={error} onRetry={() => check()} /> : null}

            <Button
              onClick={() => check()}
              disabled={!file || loading}
              size="lg"
              icon={ShieldCheck}
              className="w-full !rounded-xl !py-3 text-[15px]"
            >
              Check this photo
            </Button>
          </div>
        </StepPanel>
      ) : null}

      {step === 2 ? (
        <CheckingPanel
          message="Checking your photo…"
          submessage="We are looking for people without protective gear and other unsafe conditions."
          tick={tick}
        />
      ) : null}

      {step === 3 && data ? (
        <div className="space-y-5">
          <StatusCard
            tone={status.tone.key}
            icon={status.icon}
            headline={status.headline}
            detail={status.detail}
            meta={
              <>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  {data.image.filename.length > 24 ? `${data.image.filename.slice(0, 22)}…` : data.image.filename}
                </span>
                {data.site_context ? (
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                    {data.site_context}
                  </span>
                ) : null}
              </>
            }
          />

          <FactGrid
            facts={[
              {
                label: 'People on site',
                value: data.workers_detected,
                sub: data.workers_detected === 0 ? 'Nobody visible in this photo' : 'visible in this photo',
                icon: Users,
              },
              {
                label: 'Problems found',
                value: hazards.length,
                sub:
                  hazards.length === 0
                    ? 'Nothing to fix'
                    : hazards.length === 1
                      ? 'One thing to fix'
                      : 'Things to fix',
                icon: ShieldX,
                tone: hazards.length === 0 ? 'good' : 'watch',
              },
              {
                label: 'Safety score',
                value: `${data.compliance_score}/100`,
                sub: scoreLabel(data.compliance_score),
                icon: ShieldCheck,
                tone: scoreTone(data.compliance_score),
              },
            ]}
          />

          <SimpleActions recommendations={data.recommendations} hazards={hazards} />

          <SimpleFindings ppe={data.ppe_compliance} hazards={hazards} />

          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-center shadow-soft">
            <p className="text-[12px] leading-relaxed text-slate-500">
              This is guidance, not a formal safety inspection. Always have a qualified person confirm
              on site.
            </p>
            <ExpertOnly hint="Detailed metrics, hazard locations and standard references are available in Expert View." />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pb-2">
            <Button variant="secondary" icon={RotateCcw} onClick={startOver} className="!rounded-xl">
              Check another photo
            </Button>
            <Button variant="ghost" onClick={() => setStep(1)} className="!rounded-xl">
              Change the note
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ simple bits -- */

function SimpleActions({ recommendations = [], hazards = [] }) {
  const [showAll, setShowAll] = useState(false);
  const list = recommendations.length ? recommendations : hazards.map((h) => h.recommendation);
  const visible = showAll ? list : list.slice(0, 3);

  if (!list.length) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-50 text-accent-700">
          <ListChecks size={16} />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">What to do now</h3>
          <p className="text-[11.5px] text-slate-500">Start at the top. These are in order of importance.</p>
        </div>
      </div>

      <ol className="mt-4 space-y-3">
        {visible.map((item, index) => (
          <li key={`${item.slice(0, 24)}-${index}`} className="flex gap-3">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-600 text-[11px] font-bold text-white">
              {index + 1}
            </span>
            <p className="text-[13.5px] leading-relaxed text-slate-700">{plainRewrite(item)}</p>
          </li>
        ))}
      </ol>

      {list.length > 3 ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-accent-700 hover:text-accent-800"
        >
          {showAll ? 'Show fewer' : `Show all ${list.length} actions`}
          <ChevronDown size={13} className={showAll ? 'rotate-180 transition' : 'transition'} />
        </button>
      ) : null}
    </section>
  );
}

function SimpleFindings({ ppe = [], hazards = [] }) {
  const gear = ppeSentences(ppe);
  const issues = hazards.filter((hazard) => hazard.severity !== 'low');

  return (
    <Disclosure
      title="What exactly we found"
      subtitle="Plain descriptions, no codes or measurements."
      defaultOpen
    >
      <div className="space-y-4">
        {gear.length ? (
          <div>
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Protective gear
            </p>
            <ul className="space-y-2">
              {gear.map((item) => {
                const Icon = PPE_ICON[item.kind] || HardHat;
                const tone = toneFor(item.tone);
                return (
                  <li key={item.kind} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white ${tone.muted}`}>
                      <Icon size={15} />
                    </span>
                    <span className="text-[13px] leading-snug text-slate-700">{item.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {issues.length ? (
          <div>
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Other issues
            </p>
            <ul className="space-y-2">
              {issues.map((hazard) => {
                const tone = toneFor(hazard.severity === 'critical' ? 'act' : 'watch');
                return (
                  <li key={hazard.id} className={`rounded-xl border px-3 py-2.5 ${tone.card}`}>
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone.solid}`} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold leading-snug text-slate-900">
                          {hazard.title}
                        </p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600">
                          {plainSentence(hazard.description, 150)}
                        </p>
                        {hazard.zone ? (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                            <MapPin size={10} /> {hazard.zone}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {!gear.length && !issues.length ? (
          <p className="text-[13px] text-slate-500">
            Nothing needed fixing in this photo. Keep the same controls in place.
          </p>
        ) : null}
      </div>
    </Disclosure>
  );
}

/* ------------------------------------------------------------------ expert view -- */

function ExpertSafety({
  file,
  setFile,
  siteContext,
  setSiteContext,
  strictness,
  setStrictness,
  previewUrl,
  samples,
  data,
  error,
  loading,
  progress,
  analyze,
  clearAll,
  boxes,
  hazards,
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader
            icon={HardHat}
            title="Site safety audit"
            subtitle="Upload a site photograph. The engine screens for PPE non-compliance, fall exposure and unsafe conditions."
          />
          <div className="space-y-4 p-5">
            <ImageDropzone
              file={file}
              previewUrl={previewUrl}
              onSelect={(next) => {
                setFile(next);
                analyze(next);
              }}
              onClear={clearAll}
              disabled={loading}
              label="Construction site photograph"
              samples={samples}
            />

            <Field label="Site context" hint="optional">
              <TextArea
                rows={2}
                value={siteContext}
                maxLength={300}
                onChange={(event) => setSiteContext(event.target.value)}
                placeholder={SAMPLE_CONTEXT}
                disabled={loading}
              />
            </Field>

            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-700">Inspection strictness</p>
                <p className="text-[10px] text-slate-500">Strict escalates marginal findings.</p>
              </div>
              <Toggle
                ariaLabel="Inspection strictness"
                checked={strictness}
                onChange={setStrictness}
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'strict', label: 'Strict' },
                ]}
              />
            </div>

            <Button
              onClick={analyze}
              disabled={!file || loading}
              loading={loading}
              icon={Play}
              className="w-full"
              size="lg"
            >
              {loading ? (progress < 100 ? `Uploading ${progress}%…` : 'Analysing frame…') : 'Run safety audit'}
            </Button>

            {error ? <ErrorState error={error} onRetry={analyze} /> : null}
          </div>
        </Card>

        {data ? (
          <Card>
            <CardHeader
              icon={MapPin}
              title="Frame captured"
              subtitle={`${data.image.width}×${data.image.height} px · ${data.image.filename}`}
            />
            <div className="p-4">
              {boxes.length ? (
                <>
                  <BBoxOverlay src={previewUrl} boxes={boxes} accent="#f59e0b" />
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    Highlighted regions are the areas the engine associated with each hazard. Bounding boxes are
                    indicative — verify on site.
                  </p>
                </>
              ) : (
                <Notice tone="info" title="No localised regions">
                  This analysis did not return bounding boxes, so the frame is shown without an overlay.
                </Notice>
              )}
            </div>
          </Card>
        ) : null}
      </div>

      <div className="space-y-4">
        {!data && !loading ? (
          <Card className="h-full">
            <EmptyState
              icon={ShieldCheck}
              title="No audit yet"
              description="Attach a site photograph and run the audit. Results include a compliance index, per-PPE breakdown, hazard register with severity and citations to safety standards."
            />
          </Card>
        ) : null}

        {loading && !data ? <LoadingScaffold /> : null}

        {data ? (
          <div className="animate-fade-up space-y-4">
            {data.stop_work_recommended ? (
              <div className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4">
                <ShieldX size={20} className="mt-0.5 shrink-0 text-red-600" />
                <div>
                  <p className="text-sm font-bold uppercase tracking-wide text-red-800">Stop-work recommended</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-red-700">
                    A critical-severity hazard was identified. Suspend the affected activity and verify on site
                    before permitting crews back into the zone.
                  </p>
                </div>
              </div>
            ) : null}

            <Card>
              <CardHeader
                icon={ShieldCheck}
                title="Compliance summary"
                subtitle={data.site_context ? `Context: ${data.site_context}` : 'Site-wide assessment'}
                action={<SeverityPill value={data.overall_risk} />}
              />
              <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr]">
                <div className="flex items-center gap-4">
                  <RadialGauge
                    value={data.compliance_score}
                    color={riskRamp(100 - data.compliance_score)}
                    label={data.compliance_score}
                    sublabel="index"
                  />
                  <div className="space-y-1.5">
                    <StatTile label="Workers" value={data.workers_detected} icon={Users} className="!p-2" />
                    <StatTile label="Hazards" value={hazards.length} icon={ShieldX} className="!p-2" />
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] leading-relaxed text-slate-700">{data.summary}</p>
                  <div className="mt-3">
                    <SectionTitle hint="weighted by PPE risk">PPE compliance</SectionTitle>
                    {data.ppe_compliance.length ? (
                      <div className="space-y-2.5">
                        {data.ppe_compliance.map((item) => {
                          const ok = item.workers_checked - item.violations;
                          const rate = item.workers_checked ? (ok / item.workers_checked) * 100 : 100;
                          return (
                            <Meter
                              key={item.kind}
                              value={rate}
                              color={rate >= 90 ? '#10b981' : rate >= 70 ? '#f59e0b' : '#ef4444'}
                              label={titleCase(item.kind)}
                              caption={`${ok}/${item.workers_checked} compliant`}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No PPE items were assessable in this frame.</p>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader
                icon={ShieldX}
                title="Hazard register"
                subtitle={`${hazards.length} finding${hazards.length === 1 ? '' : 's'}, ordered by severity`}
              />
              <ul className="divide-y divide-slate-100">
                {hazards.map((hazard) => (
                  <HazardRow key={hazard.id} hazard={hazard} />
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader
                icon={ListChecks}
                title="Corrective action plan"
                subtitle="Priority-ordered actions for the site supervisor"
              />
              <ol className="space-y-2.5 p-5">
                {data.recommendations.map((recommendation, index) => (
                  <li key={`${recommendation.slice(0, 24)}-${index}`} className="flex gap-3">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-600 text-[10px] font-bold text-white">
                      {index + 1}
                    </span>
                    <p className="text-[13px] leading-relaxed text-slate-700">{recommendation}</p>
                  </li>
                ))}
              </ol>
              <div className="px-5 pb-4">
                <EngineFooter engine={data.engine} />
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HazardRow({ hazard }) {
  const [open, setOpen] = useState(false);
  const style = severityStyle(hazard.severity);

  return (
    <li className="px-5 py-3.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 text-left"
        aria-expanded={open}
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-slate-400">{hazard.id}</span>
            <SeverityPill value={hazard.severity} />
            <Badge tone="slate">{titleCase(hazard.category)}</Badge>
            {hazard.workers_at_risk > 0 ? (
              <Badge tone="amber" icon={Users}>
                {hazard.workers_at_risk} at risk
              </Badge>
            ) : null}
          </span>
          <span className="mt-1 block text-[13px] font-semibold leading-snug text-slate-900">{hazard.title}</span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
            {hazard.zone} · confidence {(hazard.confidence * 100).toFixed(0)}%
          </span>
        </span>
        <ChevronDown
          size={15}
          className={`mt-1 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="ml-5 mt-3 space-y-3 border-l-2 border-slate-100 pl-4">
          <p className="text-[13px] leading-relaxed text-slate-700">{hazard.description}</p>

          {hazard.evidence.length ? (
            <div>
              <SectionTitle>Visual evidence</SectionTitle>
              <ul className="flex flex-wrap gap-1.5">
                {hazard.evidence.map((item) => (
                  <li key={item} className="rounded bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-600">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-lg border border-accent-200 bg-accent-50/60 p-3">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent-700">
              <ClipboardCheck size={12} /> Recommended action
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-800">{hazard.recommendation}</p>
          </div>

          <p className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
            <Info size={11} /> {hazard.standard_reference}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function LoadingScaffold() {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <div className="h-[108px] w-[108px] shrink-0 animate-pulse rounded-full bg-slate-100" />
        <div className="flex-1 space-y-3">
          <SkeletonBlock lines={2} />
          <SkeletonBlock lines={3} />
        </div>
      </div>
      <div className="mt-6 space-y-3">
        <SkeletonBlock lines={4} />
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-slate-400">
        Running PPE heuristics · computing compliance index · assembling hazard register…
      </p>
    </Card>
  );
}

export { SwitchLink };
