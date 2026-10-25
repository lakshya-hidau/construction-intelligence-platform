import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarClock,
  CircleDot,
  Eye,
  Gauge,
  Hammer,
  Info,
  Lightbulb,
  Play,
  RotateCcw,
  Ruler,
  ScanLine,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAsyncAction, useObjectUrl, useSamples } from '../hooks/useAsync';
import { useViewMode } from '../lib/viewMode';
import { riskRamp, severityStyle, titleCase } from '../lib/format';
import {
  crackStatus,
  plainCrackType,
  plainPriority,
  plainSentence,
  plainSurface,
  plainWidth,
  toneFor,
} from '../lib/plainEnglish';
import ImageDropzone, { BBoxOverlay } from './ui/ImageDropzone';
import StatusCard, { FactGrid } from './ui/StatusCard';
import Disclosure from './ui/Disclosure';
import { CheckingPanel, StepPanel, Stepper } from './ui/Wizard';
import { ExpertOnly } from './ui/ViewModeToggle';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  EngineFooter,
  ErrorState,
  Field,
  Notice,
  RadialGauge,
  SectionTitle,
  Select,
  SeverityPill,
  SkeletonBlock,
  StatTile,
  TextArea,
} from './ui/Primitives';

const SURFACE_OPTIONS = [
  { value: 'unknown', label: 'Auto-detect surface' },
  { value: 'concrete_column', label: 'Concrete column' },
  { value: 'concrete_beam', label: 'Concrete beam' },
  { value: 'slab_soffit', label: 'Slab soffit' },
  { value: 'masonry_wall', label: 'Masonry wall' },
  { value: 'retaining_wall', label: 'Retaining wall' },
  { value: 'plaster_render', label: 'Plaster / render' },
  { value: 'pavement_hardstand', label: 'Pavement / hardstand' },
];

const PRIORITY_TONE = { immediate: 'red', short_term: 'amber', monitor: 'blue' };

const WIZARD_STEPS = [
  { id: 'upload', short: 'Photo', label: 'Add a photo', hint: 'Of the crack' },
  { id: 'check', short: 'Check', label: 'Quick check', hint: 'We read the crack pattern' },
  { id: 'advice', short: 'Advice', label: 'What to do', hint: 'Clear next steps' },
];

export default function CrackAnalyzer({ onRequireBackend }) {
  const { isExpert } = useViewMode();
  const samples = useSamples('crack');

  const [file, setFile] = useState(null);
  const [surfaceType, setSurfaceType] = useState('unknown');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState(1);
  const [tick, setTick] = useState(0);

  const previewUrl = useObjectUrl(file);

  const runCrack = useCallback(
    (f, surface, note, onProgress) => api.analyzeCrack(f, { surfaceType: surface, notes: note }, onProgress),
    [],
  );
  const { data, error, loading, progress, run, reset } = useAsyncAction(runCrack, { onProgress: true });

  useEffect(() => {
    if (!loading) return undefined;
    setTick(0);
    const id = setInterval(() => setTick((value) => value + 1), 700);
    return () => clearInterval(id);
  }, [loading]);

  // See SafetyMonitor: sample chips pass their fresh file so the run does not read
  // a stale `file` from this render's closure.
  const check = useCallback(
    async (overrideFile) => {
      // A click event can reach here through onClick; only accept a real File.
      const target = overrideFile instanceof File ? overrideFile : file;
      if (!target) return;
      setStep(2);
      const result = await run(target, surfaceType, notes);
      if (result) {
        setStep(3);
      } else {
        setStep(1);
        onRequireBackend?.();
      }
    },
    [file, surfaceType, notes, run, onRequireBackend],
  );

  const startOver = () => {
    setFile(null);
    setNotes('');
    reset();
    setStep(1);
  };

  const boxes = useMemo(
    () => (data?.detections ?? []).map((detection) => ({ ...detection, label: detection.label || 'crack trace' })),
    [data],
  );
  const status = data ? crackStatus(data) : null;

  if (isExpert) {
    return (
      <ExpertCrack
        file={file}
        setFile={setFile}
        surfaceType={surfaceType}
        setSurfaceType={setSurfaceType}
        notes={notes}
        setNotes={setNotes}
        previewUrl={previewUrl}
        samples={samples}
        data={data}
        error={error}
        loading={loading}
        progress={progress}
        analyze={check}
        clearAll={startOver}
        boxes={boxes}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Stepper steps={WIZARD_STEPS} current={step} onJump={(target) => target < step && setStep(target)} />

      {step === 1 ? (
        <StepPanel
          title="Add a photo of the crack"
          description="Stand close enough that the crack fills a good part of the photo. Put a coin or a ruler beside it if you have one — it helps judge the size."
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
              label="Photo of the crack"
              samples={samples}
            />

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Lightbulb size={13} className="text-amber-500" /> For a better check
              </p>
              <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-slate-600">
                <li>• Photograph straight on, not at an angle.</li>
                <li>• Include the whole length of the crack.</li>
                <li>• Day­light or a torch — avoid flash reflections.</li>
              </ul>
            </div>

            <Disclosure title="Add details (optional)" subtitle="What surface is it, and anything you noticed.">
              <div className="space-y-3">
                <Field label="Where is the crack?">
                  <Select
                    options={SURFACE_OPTIONS}
                    value={surfaceType}
                    onChange={(event) => setSurfaceType(event.target.value)}
                    disabled={loading}
                  />
                </Field>
                <Field label="Your note">
                  <TextArea
                    rows={2}
                    maxLength={800}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="e.g. Noticed this after the plaster was removed."
                    disabled={loading}
                  />
                </Field>
              </div>
            </Disclosure>

            {error ? <ErrorState error={error} onRetry={() => check()} /> : null}

            <Button
              onClick={() => check()}
              disabled={!file || loading}
              size="lg"
              icon={ScanLine}
              className="w-full !rounded-xl !py-3 text-[15px]"
            >
              Check this crack
            </Button>
          </div>
        </StepPanel>
      ) : null}

      {step === 2 ? (
        <CheckingPanel
          message="Reading the crack…"
          submessage="We check the shape, direction and size of the crack to judge how serious it is."
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
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                {data.image.filename.length > 24 ? `${data.image.filename.slice(0, 22)}…` : data.image.filename}
              </span>
            }
          />

          <FactGrid
            facts={[
              {
                label: 'Type of crack',
                value: plainCrackType(data.crack_type).split(' (')[0],
                sub: plainCrackType(data.crack_type).includes('(')
                  ? plainCrackType(data.crack_type).split('(')[1].replace(')', '')
                  : 'what the pattern suggests',
                icon: Activity,
                tone: status.tone.key,
              },
              {
                label: 'How wide',
                value: plainWidth(data.width_class),
                sub: data.crack_type === 'none_observed' ? 'no crack measured' : 'compared with normal limits',
                icon: Ruler,
              },
              {
                label: 'Where',
                value: plainSurface(data.surface_type).replace(/^./, (c) => c.toUpperCase()),
                sub: 'the surface we looked at',
                icon: Eye,
              },
            ]}
          />

          <SimpleCrackActions remediation={data.remediation} />

          <Disclosure title="What this means" subtitle="Explained without technical terms." defaultOpen>
            <div className="space-y-4">
              <p className="text-[13.5px] leading-relaxed text-slate-700">
                {plainSentence(data.structural_implication, 260)}
              </p>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
                  <Gauge size={12} /> Keep watching it
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-700">
                  {plainSentence(data.monitoring_plan, 240)}
                </p>
              </div>
              {data.requires_engineer_review ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-red-600" />
                  <p className="text-[12.5px] leading-relaxed text-red-800">
                    Have a qualified structural engineer confirm this before any repair work starts. Do not
                    simply plaster over it.
                  </p>
                </div>
              ) : null}
            </div>
          </Disclosure>

          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-center shadow-soft">
            <p className="text-[12px] leading-relaxed text-slate-500">
              This is a first look only — a photo cannot replace an engineer&apos;s inspection.
            </p>
            <ExpertOnly hint="Crack measurements, severity scoring and cited standards are available in Expert View." />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pb-2">
            <Button variant="secondary" icon={RotateCcw} onClick={startOver} className="!rounded-xl">
              Check another photo
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SimpleCrackActions({ remediation = [] }) {
  const tone = (priority) => plainPriority(priority);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-50 text-accent-700">
          <Hammer size={16} />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">What to do</h3>
          <p className="text-[11.5px] text-slate-500">In order, starting with the most urgent.</p>
        </div>
      </div>

      <ol className="mt-4 space-y-3.5">
        {remediation.map((action, index) => {
          const priority = tone(action.priority);
          const styles = toneFor(priority.tone);
          return (
            <li key={`${action.action.slice(0, 20)}-${index}`} className="rounded-xl border border-slate-100 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${styles.chip}`}>
                  {priority.label}
                </span>
                <span className="text-[11px] text-slate-400">when: {action.timeframe}</span>
              </div>
              <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-slate-900">{action.action}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{plainSentence(action.detail, 220)}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ expert view -- */

function ExpertCrack({
  file,
  setFile,
  surfaceType,
  setSurfaceType,
  notes,
  setNotes,
  previewUrl,
  samples,
  data,
  error,
  loading,
  progress,
  analyze,
  clearAll,
  boxes,
}) {
  const style = data ? severityStyle(data.severity) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader
            icon={ScanLine}
            title="Crack & structural analysis"
            subtitle="Photograph a concrete or masonry surface. The engine classifies crack pattern, grades severity and proposes remediation."
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
              label="Structural surface photograph"
              samples={samples}
            />

            <Field label="Surface type" hint="improves accuracy">
              <Select
                options={SURFACE_OPTIONS}
                value={surfaceType}
                onChange={(event) => setSurfaceType(event.target.value)}
                disabled={loading}
              />
            </Field>

            <Field label="Engineer's note" hint="optional">
              <TextArea
                rows={2}
                maxLength={800}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. Beam soffit near support, noticed after de-shuttering."
                disabled={loading}
              />
            </Field>

            <Button
              onClick={analyze}
              disabled={!file || loading}
              loading={loading}
              icon={Play}
              size="lg"
              className="w-full"
            >
              {loading ? (progress < 100 ? `Uploading ${progress}%…` : 'Analysing surface…') : 'Analyse structural image'}
            </Button>

            {error ? <ErrorState error={error} onRetry={analyze} /> : null}
          </div>
        </Card>

        {data ? (
          <Card>
            <CardHeader
              icon={Eye}
              title="Detected crack traces"
              subtitle={`${data.detections.length} region${data.detections.length === 1 ? '' : 's'} localised`}
            />
            <div className="p-4">
              {boxes.length ? (
                <BBoxOverlay src={previewUrl} boxes={boxes} accent={style.hex} />
              ) : (
                <Notice tone="info" title="No localised regions">
                  The analyser graded this surface but did not return a crack bounding box, so no overlay is drawn.
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
              icon={ScanLine}
              title="No analysis yet"
              description="Attach a structural photograph. You'll get a width classification against ACI 224 / IS 456 banding, a severity grade, structural significance, and a remediation sequence with citations."
            />
          </Card>
        ) : null}

        {loading && !data ? (
          <Card className="space-y-5 p-5">
            <SkeletonBlock lines={3} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="h-16 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
            <SkeletonBlock lines={5} />
          </Card>
        ) : null}

        {data ? (
          <div className="animate-fade-up space-y-4">
            {data.requires_engineer_review ? (
              <div className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4">
                <TriangleAlert size={20} className="mt-0.5 shrink-0 text-red-600" />
                <div>
                  <p className="text-sm font-bold uppercase tracking-wide text-red-800">Engineer review required</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-red-700">
                    This pattern meets the escalation criteria for a licensed structural assessment. Do not instruct
                    repair from this screen alone.
                  </p>
                </div>
              </div>
            ) : null}

            <Card>
              <CardHeader
                icon={Gauge}
                title="Severity assessment"
                subtitle={`${titleCase(data.crack_type)} pattern on ${titleCase(data.surface_type)}`}
                action={<SeverityPill value={data.severity} />}
              />
              <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr]">
                <div className="flex items-center gap-4">
                  <RadialGauge
                    value={data.severity_score}
                    color={riskRamp(data.severity_score)}
                    label={data.severity_score}
                    sublabel="severity"
                  />
                  <div className="space-y-1.5">
                    <StatTile label="Width class" value={titleCase(data.width_class)} className="!p-2" />
                    <StatTile
                      label="Structural"
                      value={data.is_structurally_significant ? 'Yes' : 'No'}
                      tone={data.is_structurally_significant ? 'red' : 'green'}
                      className="!p-2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <StatTile
                    label="Width"
                    value={`${data.measurement.estimated_width_mm}`}
                    sub="mm estimated"
                    icon={Ruler}
                  />
                  <StatTile
                    label="Length"
                    value={`${data.measurement.estimated_length_m}`}
                    sub="metres"
                    icon={Activity}
                  />
                  <StatTile
                    label="Orientation"
                    value={`${Math.round(data.measurement.orientation_deg)}°`}
                    sub="to horizontal"
                    icon={CircleDot}
                  />
                  <StatTile
                    label="Branching"
                    value={data.measurement.branching ? 'Yes' : 'No'}
                    sub={data.measurement.spalling_present ? 'spalling present' : 'no spalling'}
                    icon={Sparkles}
                    tone={data.measurement.spalling_present ? 'amber' : 'slate'}
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 px-5 py-4">
                <SectionTitle>Structural implication</SectionTitle>
                <p className="text-[13px] leading-relaxed text-slate-700">{data.structural_implication}</p>
              </div>

              <div className="border-t border-slate-200 px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  {data.measurement.efflorescence ? <Badge tone="amber">Efflorescence</Badge> : null}
                  {data.measurement.spalling_present ? <Badge tone="red">Spalling</Badge> : null}
                  {data.measurement.branching ? <Badge tone="violet">Branching pattern</Badge> : null}
                  <Badge tone="slate">Grade: {titleCase(data.severity)}</Badge>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader
                icon={Hammer}
                title="Remediation plan"
                subtitle="Prioritised method statements with standard references"
              />
              <ol className="divide-y divide-slate-100">
                {data.remediation.map((action, index) => {
                  const badgeTone = PRIORITY_TONE[action.priority] || 'slate';
                  return (
                    <li key={`${action.action.slice(0, 20)}-${index}`} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={badgeTone} icon={CalendarClock}>
                          {titleCase(action.priority)}
                        </Badge>
                        <span className="text-[10px] font-medium text-slate-500">{action.timeframe}</span>
                        {action.estimated_cost_band ? (
                          <Badge
                            tone={
                              action.estimated_cost_band === 'high'
                                ? 'red'
                                : action.estimated_cost_band === 'medium'
                                  ? 'amber'
                                  : 'green'
                            }
                          >
                            {titleCase(action.estimated_cost_band)} cost
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-900">{action.action}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{action.detail}</p>
                      <p className="mt-1.5 font-mono text-[10px] text-slate-400">{action.standard_reference}</p>
                    </li>
                  );
                })}
              </ol>
            </Card>

            <Card>
              <CardHeader icon={Info} title="Monitoring plan" subtitle="How to confirm whether the crack is active" />
              <div className="p-5">
                <p className="text-[13px] leading-relaxed text-slate-700">{data.monitoring_plan}</p>
                <div className="mt-4 rounded-lg bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Summary</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{data.summary}</p>
                </div>
                <EngineFooter engine={data.engine} />
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
