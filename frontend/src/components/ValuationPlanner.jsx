import { useCallback, useMemo, useState } from 'react';
import {
  ArrowRight,
  Banknote,
  Building2,
  CalendarCheck,
  CalendarRange,
  Calculator,
  ChartNoAxesColumn,
  CircleDollarSign,
  Clock,
  Flag,
  HardHat,
  Layers,
  MapPin,
  Percent,
  Play,
  Ruler,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAsyncAction } from '../hooks/useAsync';
import { useViewMode } from '../lib/viewMode';
import { humanDate, inr, num, shortDate, titleCase } from '../lib/format';
import {
  firstSentence,
  monthYear,
  plainDuration,
  plainPhase,
  plainProperty,
  plainRewrite,
} from '../lib/plainEnglish';
import StatusCard, { FactGrid } from './ui/StatusCard';
import Disclosure from './ui/Disclosure';
import { ExpertOnly } from './ui/ViewModeToggle';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  EngineFooter,
  ErrorState,
  Field,
  Meter,
  SectionTitle,
  Select,
  SkeletonBlock,
  StatTile,
  Tabs,
  TextInput,
} from './ui/Primitives';

const PROPERTY_TYPES = [
  { value: 'apartment', label: 'Apartment' },
  { value: 'villa', label: 'Villa / row house' },
  { value: 'commercial_retail', label: 'Commercial retail' },
  { value: 'office', label: 'Office' },
  { value: 'industrial_warehouse', label: 'Industrial / warehouse' },
  { value: 'residential_plot', label: 'Residential plot' },
];
const FINISH = [
  { value: 'basic', label: 'Basic' },
  { value: 'standard', label: 'Standard' },
  { value: 'premium', label: 'Premium' },
  { value: 'luxury', label: 'Luxury' },
];
const STRUCTURE = [
  { value: 'rcc_frame', label: 'RCC frame' },
  { value: 'load_bearing', label: 'Load bearing' },
  { value: 'steel_frame', label: 'Steel frame' },
  { value: 'hybrid', label: 'Hybrid' },
];
const PHASES = [
  { value: 'planning', label: 'Planning' },
  { value: 'foundation', label: 'Foundation' },
  { value: 'structure', label: 'Structure' },
  { value: 'envelope', label: 'Envelope' },
  { value: 'finishing', label: 'Finishing' },
  { value: 'handover', label: 'Handover' },
  { value: 'completed', label: 'Completed' },
];
const AMENITIES = [
  'swimming pool',
  'clubhouse',
  'gym',
  'covered parking',
  'ev charging',
  'power backup',
  'lift',
  'modular kitchen',
  'landscaped garden',
  "children's play area",
  'smart home automation',
];
const PROCUREMENT = [
  { value: 'item_rate', label: 'Item rate' },
  { value: 'epc_lump_sum', label: 'EPC lump sum' },
  { value: 'design_build', label: 'Design & build' },
];

const HEALTH_TONE = {
  on_track: { tone: 'green', label: 'On track' },
  tight: { tone: 'amber', label: 'Tight' },
  aggressive: { tone: 'red', label: 'Aggressive' },
  unrealistic: { tone: 'red', label: 'Unrealistic' },
};

const DEFAULTS_VALUATION = {
  city: 'Indore',
  locality: 'Vijay Nagar',
  property_type: 'apartment',
  super_builtup_area_sqft: 1650,
  carpet_area_sqft: 1180,
  age_years: 4,
  floor_number: 7,
  floors_total: 12,
  finish_grade: 'premium',
  structure_type: 'rcc_frame',
  project_phase: 'completed',
  parking_slots: 2,
  amenities: ['swimming pool', 'gym', 'power backup', 'covered parking'],
  monthly_rent_estimate: 26000,
};

const DEFAULTS_PLAN = {
  project_name: 'Indore Trade Centre',
  city: 'Indore',
  project_type: 'commercial_retail',
  structure_type: 'rcc_frame',
  total_area_sqft: 120000,
  floors: 8,
  units: 42,
  start_date: new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10),
  target_duration_weeks: 60,
  current_phase: 'planning',
  procurement_mode: 'epc_lump_sum',
  site_constraints: ['Working frontage limited to 40 m', 'No night working permitted'],
};

export default function ValuationPlanner({ onRequireBackend }) {
  const [tab, setTab] = useState('valuation');
  const { isExpert } = useViewMode();

  // Simple View gets a purpose-built screen rather than a trimmed copy of the console:
  // two questions ("what is it worth?" / "how long will it take?"), one answer each,
  // with the model's workings folded away behind a disclosure.
  if (!isExpert) return <SimpleCommercial onRequireBackend={onRequireBackend} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Commercial intelligence</h2>
          <p className="text-xs text-slate-500">
            Transparent hedonic valuation and CPM-based programme generation — every number is reproducible.
          </p>
        </div>
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'valuation', label: 'Valuation', icon: CircleDollarSign },
            { id: 'planning', label: 'Project planning', icon: CalendarRange },
          ]}
        />
      </div>

      {tab === 'valuation' ? <ValuationPanel onRequireBackend={onRequireBackend} /> : <PlanningPanel onRequireBackend={onRequireBackend} />}
    </div>
  );
}

/* ===================================================================== VALUATION == */

function ValuationPanel({ onRequireBackend }) {
  const [form, setForm] = useState(DEFAULTS_VALUATION);
  const [fieldErrors, setFieldErrors] = useState({});

  const runValuation = useCallback((payload) => api.valuation(payload), []);
  const { data, error, loading, run } = useAsyncAction(runValuation);

  const set = (key) => (event) => {
    const raw = event?.target ? event.target.value : event;
    const numeric = [
      'super_builtup_area_sqft',
      'carpet_area_sqft',
      'age_years',
      'floor_number',
      'floors_total',
      'parking_slots',
      'monthly_rent_estimate',
    ].includes(key);
    setForm((f) => ({ ...f, [key]: numeric ? (raw === '' ? '' : Number(raw)) : raw }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
  };

  const toggleAmenity = (a) =>
    setForm((f) => ({
      ...f,
      amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a],
    }));

  const submit = async (event) => {
    event?.preventDefault();
    const errors = {};
    if (!form.city || form.city.trim().length < 2) errors.city = 'Enter a city name.';
    if (!form.super_builtup_area_sqft || form.super_builtup_area_sqft < 100)
      errors.super_builtup_area_sqft = 'Minimum 100 sqft.';
    if (form.carpet_area_sqft && form.carpet_area_sqft > form.super_builtup_area_sqft)
      errors.carpet_area_sqft = 'Carpet area cannot exceed super built-up area.';
    if (Number(form.floor_number) > Number(form.floors_total))
      errors.floor_number = 'Floor cannot exceed total floors.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const payload = {
      ...form,
      super_builtup_area_sqft: Number(form.super_builtup_area_sqft),
      age_years: Number(form.age_years) || 0,
      floor_number: Number(form.floor_number) || 0,
      floors_total: Number(form.floors_total) || 1,
      parking_slots: Number(form.parking_slots) || 0,
      ...(form.carpet_area_sqft ? { carpet_area_sqft: Number(form.carpet_area_sqft) } : {}),
      ...(form.monthly_rent_estimate ? { monthly_rent_estimate: Number(form.monthly_rent_estimate) } : {}),
    };
    const result = await run(payload);
    if (result === undefined && onRequireBackend) onRequireBackend();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader icon={Calculator} title="Valuation inputs" subtitle="City, area basis and specification drive the estimate." />
        <form onSubmit={submit} className="space-y-3.5 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" required error={fieldErrors.city}>
              <TextInput value={form.city} onChange={set('city')} placeholder="Indore" />
            </Field>
            <Field label="Locality" hint="optional">
              <TextInput value={form.locality} onChange={set('locality')} placeholder="Vijay Nagar" />
            </Field>
          </div>

          <Field label="Asset class">
            <Select options={PROPERTY_TYPES} value={form.property_type} onChange={set('property_type')} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Super built-up" hint="sqft" required error={fieldErrors.super_builtup_area_sqft}>
              <TextInput type="number" min="100" value={form.super_builtup_area_sqft} onChange={set('super_builtup_area_sqft')} />
            </Field>
            <Field label="Carpet area" hint="sqft" error={fieldErrors.carpet_area_sqft}>
              <TextInput type="number" min="0" value={form.carpet_area_sqft} onChange={set('carpet_area_sqft')} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Age" hint="yrs">
              <TextInput type="number" min="0" max="120" value={form.age_years} onChange={set('age_years')} />
            </Field>
            <Field label="Floor" error={fieldErrors.floor_number}>
              <TextInput type="number" value={form.floor_number} onChange={set('floor_number')} />
            </Field>
            <Field label="Of total">
              <TextInput type="number" min="1" value={form.floors_total} onChange={set('floors_total')} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Finish grade">
              <Select options={FINISH} value={form.finish_grade} onChange={set('finish_grade')} />
            </Field>
            <Field label="Structure">
              <Select options={STRUCTURE} value={form.structure_type} onChange={set('structure_type')} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Delivery status">
              <Select options={PHASES} value={form.project_phase} onChange={set('project_phase')} />
            </Field>
            <Field label="Parking" hint="slots">
              <TextInput type="number" min="0" max="20" value={form.parking_slots} onChange={set('parking_slots')} />
            </Field>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-700">Amenities</p>
            <div className="flex flex-wrap gap-1.5">
              {AMENITIES.map((a) => (
                <Chip key={a} active={form.amenities.includes(a)} onClick={() => toggleAmenity(a)}>
                  {titleCase(a)}
                </Chip>
              ))}
            </div>
          </div>

          <Field label="Monthly rent estimate" hint="for yield cross-check">
            <TextInput type="number" min="0" value={form.monthly_rent_estimate} onChange={set('monthly_rent_estimate')} />
          </Field>

          <Button type="submit" loading={loading} icon={Play} size="lg" className="w-full">
            {loading ? 'Valuing…' : 'Estimate value'}
          </Button>

          {error ? <ErrorState error={error} onRetry={submit} /> : null}
        </form>
      </Card>

      <div className="space-y-4">
        {!data && !loading ? (
          <Card className="h-full">
            <EmptyState
              icon={Banknote}
              title="No estimate yet"
              description="Fill in the property profile and run the valuation. Every adjustment is itemised so you can see exactly why the estimate moved."
            />
          </Card>
        ) : null}

        {loading && !data ? (
          <Card className="space-y-4 p-5">
            <SkeletonBlock lines={2} />
            <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
            <SkeletonBlock lines={6} />
          </Card>
        ) : null}

        {data ? (
          <div className="animate-fade-up space-y-4">
            <Card>
              <CardHeader
                icon={CircleDollarSign}
                title="Estimated market value"
                subtitle={`${num(data.area_basis_sqft)} sqft on ${form.property_type === 'residential_plot' ? 'land' : 'super built-up'} basis`}
                action={
                  <Badge tone={data.confidence >= 0.65 ? 'green' : data.confidence >= 0.45 ? 'amber' : 'red'}>
                    {titleCase(data.confidence_label)} confidence
                  </Badge>
                }
              />
              <div className="p-5">
                <p className="font-mono text-3xl font-semibold tracking-tight text-slate-900">
                  {inr(data.estimated_value)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Range {inr(data.range_low, { compact: true })} – {inr(data.range_high, { compact: true })} ·{' '}
                  {inr(data.price_per_sqft)}/sqft
                </p>

                <div className="relative mt-5 h-2 rounded-full bg-slate-200">
                  <div
                    className="absolute inset-y-0 rounded-full bg-accent-200"
                    style={{
                      left: '0%',
                      right: '0%',
                    }}
                  />
                  <div
                    className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-accent-700"
                    style={{
                      left: `${Math.max(0, Math.min(100, ((data.estimated_value - data.range_low) / Math.max(1, data.range_high - data.range_low)) * 100))}%`,
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
                  <span>{inr(data.range_low, { compact: true })}</span>
                  <span>{inr(data.range_high, { compact: true })}</span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <StatTile label="Base rate" value={inr(data.base_rate_per_sqft)} sub="per sqft" />
                  <StatTile label="Area basis" value={num(data.area_basis_sqft)} sub="sqft" icon={Layers} />
                  <StatTile
                    label="Rental yield"
                    value={data.rental_yield_pct != null ? `${data.rental_yield_pct}%` : '—'}
                    sub={data.rental_yield_pct != null ? 'gross annual' : 'no rent given'}
                    icon={Percent}
                    tone={data.rental_yield_pct != null && data.rental_yield_pct < 2 ? 'amber' : 'green'}
                  />
                  <StatTile label="Drivers" value={data.drivers.length} sub="adjustments" icon={ChartNoAxesColumn} />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader icon={TrendingUp} title="Value drivers" subtitle="Signed impact of each adjustment on the estimate" />
              <ul className="divide-y divide-slate-100">
                {data.drivers.map((d, i) => {
                  const positive = d.impact_pct > 0.01;
                  const negative = d.impact_pct < -0.01;
                  const Icon = positive ? TrendingUp : negative ? TrendingDown : ArrowRight;
                  const max = Math.max(...data.drivers.map((x) => Math.abs(x.impact_pct)), 1);
                  return (
                    <li key={`${d.label}-${i}`} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-800">
                            <Icon
                              size={13}
                              className={positive ? 'text-emerald-600' : negative ? 'text-red-600' : 'text-slate-400'}
                            />
                            {d.label}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{d.explanation}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={`font-mono text-[13px] font-semibold ${
                              positive ? 'text-emerald-700' : negative ? 'text-red-700' : 'text-slate-500'
                            }`}
                          >
                            {d.impact_pct > 0 ? '+' : ''}
                            {d.impact_pct.toFixed(1)}%
                          </p>
                          <p className="font-mono text-[10px] text-slate-400">{inr(d.impact_amount, { compact: true })}</p>
                        </div>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-1 rounded-full ${positive ? 'bg-emerald-400' : negative ? 'bg-red-400' : 'bg-slate-300'}`}
                          style={{ width: `${(Math.abs(d.impact_pct) / max) * 100}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader icon={ChartNoAxesColumn} title="Market commentary" />
                <div className="space-y-3 p-5">
                  <p className="text-[12.5px] leading-relaxed text-slate-700">{data.comparable_note}</p>
                  <p className="text-[12.5px] leading-relaxed text-slate-600">{data.market_outlook}</p>
                </div>
              </Card>
              <Card>
                <CardHeader icon={ShieldAlert} title="Risk flags" subtitle="Assumptions that could move the value" />
                <div className="p-5">
                  {data.risk_flags.length ? (
                    <ul className="space-y-2">
                      {data.risk_flags.map((flag) => (
                        <li key={flag} className="flex gap-2 text-[12px] leading-relaxed text-slate-700">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                          {flag}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500">No material risk flags for this profile.</p>
                  )}
                </div>
              </Card>
            </div>

            <Card className="p-5">
              <SectionTitle>Methodology</SectionTitle>
              <p className="text-[12px] leading-relaxed text-slate-600">{data.methodology}</p>
              <EngineFooter engine={data.engine} />
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ====================================================================== PLANNING == */

function PlanningPanel({ onRequireBackend }) {
  const [form, setForm] = useState(DEFAULTS_PLAN);
  const [constraintDraft, setConstraintDraft] = useState('');

  const runPlan = useCallback((payload) => api.plan(payload), []);
  const { data, error, loading, run } = useAsyncAction(runPlan);

  const set = (key) => (event) => {
    const raw = event?.target ? event.target.value : event;
    const numeric = ['total_area_sqft', 'floors', 'units', 'target_duration_weeks'];
    setForm((f) => ({ ...f, [key]: numeric.includes(key) ? (raw === '' ? '' : Number(raw)) : raw }));
  };

  const addConstraint = () => {
    const value = constraintDraft.trim();
    if (!value) return;
    setForm((f) => ({ ...f, site_constraints: [...f.site_constraints, value].slice(0, 12) }));
    setConstraintDraft('');
  };

  const submit = async (event) => {
    event?.preventDefault();
    const payload = {
      ...form,
      total_area_sqft: Number(form.total_area_sqft),
      floors: Number(form.floors),
      units: Number(form.units),
      ...(form.target_duration_weeks ? { target_duration_weeks: Number(form.target_duration_weeks) } : {}),
    };
    const result = await run(payload);
    if (result === undefined && onRequireBackend) onRequireBackend();
  };

  const health = data ? HEALTH_TONE[data.schedule_health] : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader icon={CalendarRange} title="Project brief" subtitle="Generates a dated milestone programme with phase task breakdown." />
        <form onSubmit={submit} className="space-y-3.5 p-5">
          <Field label="Project name" required>
            <TextInput value={form.project_name} onChange={set('project_name')} placeholder="Indore Trade Centre" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="City" required>
              <TextInput value={form.city} onChange={set('city')} />
            </Field>
            <Field label="Asset class">
              <Select options={PROPERTY_TYPES} value={form.project_type} onChange={set('project_type')} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Total BUA" hint="sqft">
              <TextInput type="number" min="500" value={form.total_area_sqft} onChange={set('total_area_sqft')} />
            </Field>
            <Field label="Floors">
              <TextInput type="number" min="1" max="80" value={form.floors} onChange={set('floors')} />
            </Field>
            <Field label="Units">
              <TextInput type="number" min="1" value={form.units} onChange={set('units')} />
            </Field>
          </div>
          <p className="-mt-1 text-[10px] leading-relaxed text-slate-400">
            Total built-up is summed across all floors, not per floor.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" required>
              <TextInput type="date" value={form.start_date} onChange={set('start_date')} />
            </Field>
            <Field label="Target duration" hint="weeks">
              <TextInput type="number" min="4" value={form.target_duration_weeks} onChange={set('target_duration_weeks')} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Structure">
              <Select options={STRUCTURE} value={form.structure_type} onChange={set('structure_type')} />
            </Field>
            <Field label="Current phase">
              <Select options={PHASES} value={form.current_phase} onChange={set('current_phase')} />
            </Field>
          </div>

          <Field label="Procurement mode">
            <Select options={PROCUREMENT} value={form.procurement_mode} onChange={set('procurement_mode')} />
          </Field>

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-700">Site constraints</p>
            <div className="flex gap-2">
              <TextInput
                value={constraintDraft}
                onChange={(e) => setConstraintDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addConstraint();
                  }
                }}
                placeholder="e.g. single access road"
              />
              <Button type="button" variant="secondary" onClick={addConstraint}>
                Add
              </Button>
            </div>
            {form.site_constraints.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {form.site_constraints.map((c, i) => (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, site_constraints: f.site_constraints.filter((_, j) => j !== i) }))}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      {c} ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <Button type="submit" loading={loading} icon={Play} size="lg" className="w-full">
            {loading ? 'Generating programme…' : 'Generate programme'}
          </Button>

          {error ? <ErrorState error={error} onRetry={submit} /> : null}
        </form>
      </Card>

      <div className="space-y-4">
        {!data && !loading ? (
          <Card className="h-full">
            <EmptyState
              icon={CalendarRange}
              title="No programme yet"
              description="Describe the project and generate a dated milestone schedule, phase-wise task breakdown, resource roll-up and risk register."
            />
          </Card>
        ) : null}

        {loading && !data ? (
          <Card className="space-y-4 p-5">
            <SkeletonBlock lines={2} />
            <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
            <SkeletonBlock lines={6} />
          </Card>
        ) : null}

        {data ? (
          <div className="animate-fade-up space-y-4">
            <Card>
              <CardHeader
                icon={Target}
                title={data.project_name}
                subtitle={`${data.city} · ${data.milestones.length} milestones · ${num(data.total_duration_days)} working days`}
                action={<Badge tone={health.tone}>{health.label}</Badge>}
              />
              <div className="grid grid-cols-2 gap-2.5 p-5 sm:grid-cols-4">
                <StatTile label="Start" value={shortDate(data.computed_start_date)} sub={humanDate(data.computed_start_date)} icon={Clock} />
                <StatTile label="Handover" value={shortDate(data.computed_end_date)} sub={humanDate(data.computed_end_date)} icon={Flag} tone="blue" />
                <StatTile label="Contingency" value={`${data.buffer_days} d`} sub="schedule buffer" icon={ShieldAlert} tone="amber" />
                <StatTile label="Peak crew" value={data.resources.peak_crew} sub="direct labour" icon={Users} />
              </div>

              <div className="border-t border-slate-200 p-5">
                <SectionTitle hint="bars are proportional to duration">Critical path</SectionTitle>
                <MilestoneTimeline milestones={data.milestones} />
              </div>
            </Card>

            <Card>
              <CardHeader icon={Users} title="Resource roll-up" subtitle="Indicative quantities for procurement and cash-flow planning" />
              <div className="grid grid-cols-2 gap-2.5 p-5 sm:grid-cols-5">
                <StatTile label="Peak crew" value={num(data.resources.peak_crew)} sub="operatives" icon={HardHat} />
                <StatTile label="Labour days" value={num(data.resources.total_labour_days)} sub="man-days" icon={Users} />
                <StatTile label="Concrete" value={num(data.resources.concrete_m3_est, 0)} sub="m³" icon={Layers} />
                <StatTile label="Steel" value={num(data.resources.steel_tonnes_est, 1)} sub="tonnes" icon={Wrench} />
                <StatTile label="Formwork" value={num(data.resources.formwork_sqm_est)} sub="m²" icon={Building2} />
              </div>
            </Card>

            <Card>
              <CardHeader icon={Layers} title="Phase task breakdown" subtitle="Trade, duration, crew and predecessors per task" />
              <PhaseAccordion phases={data.phase_breakdown} milestones={data.milestones} />
            </Card>

            <Card>
              <CardHeader icon={ShieldAlert} title="Risk register" subtitle="Owner-assigned mitigations" />
              <ul className="divide-y divide-slate-100">
                {data.risks.map((risk) => (
                  <li key={risk.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-slate-400">{risk.id}</span>
                      <Badge tone="slate">{titleCase(risk.category)}</Badge>
                      <Badge tone={risk.probability === 'high' ? 'red' : risk.probability === 'medium' ? 'amber' : 'green'}>
                        P: {titleCase(risk.probability)}
                      </Badge>
                      <Badge tone={risk.impact === 'high' ? 'red' : risk.impact === 'medium' ? 'amber' : 'green'}>
                        I: {titleCase(risk.impact)}
                      </Badge>
                      <span className="ml-auto text-[10px] font-medium text-slate-500">{risk.owner}</span>
                    </div>
                    <p className="mt-1.5 text-[13px] font-medium leading-snug text-slate-900">{risk.title}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{risk.mitigation}</p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <SectionTitle>Programme narrative</SectionTitle>
              <p className="text-[12.5px] leading-relaxed text-slate-700">{data.narrative}</p>
              <EngineFooter engine={data.engine} />
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MilestoneTimeline({ milestones }) {
  const { min, max } = useMemo(() => {
    const starts = milestones.map((m) => new Date(`${m.start_date}T00:00:00`).getTime());
    const ends = milestones.map((m) => new Date(`${m.end_date}T00:00:00`).getTime());
    return { min: Math.min(...starts), max: Math.max(...ends) };
  }, [milestones]);

  const span = Math.max(max - min, 1);
  const tone = ['bg-accent-600', 'bg-accent-500', 'bg-accent-400', 'bg-sky-500', 'bg-emerald-500', 'bg-slate-400'];

  return (
    <div className="space-y-2">
      {milestones.map((m, i) => {
        const start = new Date(`${m.start_date}T00:00:00`).getTime();
        const end = new Date(`${m.end_date}T00:00:00`).getTime();
        const left = ((start - min) / span) * 100;
        const width = Math.max(((end - start) / span) * 100, 1.2);
        return (
          <div key={m.id} className="group grid grid-cols-[128px_1fr_56px] items-center gap-2.5">
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-medium text-slate-700">{titleCase(m.phase)}</p>
              <p className="truncate font-mono text-[9.5px] text-slate-400">{m.id}</p>
            </div>
            <div className="relative h-6 rounded bg-slate-100">
              <div
                className={`absolute inset-y-0 rounded ${tone[i % tone.length]} transition-all duration-700`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${m.name}: ${m.start_date} → ${m.end_date}`}
              />
              {m.completion_pct > 0 ? (
                <div
                  className="absolute inset-y-0 rounded-l bg-white/45"
                  style={{ left: `${left}%`, width: `${(width * m.completion_pct) / 100}%` }}
                />
              ) : null}
            </div>
            <p className="text-right font-mono text-[10px] text-slate-500">{m.duration_days}d</p>
          </div>
        );
      })}
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 font-mono text-[10px] text-slate-400">
        <span>{shortDate(milestones[0].start_date)}</span>
        <span>—</span>
        <span>{shortDate(milestones[milestones.length - 1].end_date)}</span>
      </div>
    </div>
  );
}

function PhaseAccordion({ phases, milestones }) {
  const [open, setOpen] = useState(phases[0]?.phase ?? null);
  const byPhase = useMemo(() => Object.fromEntries(milestones.map((m) => [m.phase, m])), [milestones]);

  return (
    <div className="divide-y divide-slate-100">
      {phases.map((phase) => {
        const isOpen = open === phase.phase;
        const ms = byPhase[phase.phase];
        return (
          <div key={phase.phase}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : phase.phase)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent-50 font-mono text-[10px] font-semibold text-accent-700">
                {phase.weight_pct.toFixed(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-slate-900">{titleCase(phase.phase)}</span>
                <span className="block font-mono text-[10px] text-slate-400">
                  {phase.window_label} · {phase.tasks.length} tasks · {ms?.crew_size ?? '—'} crew
                </span>
              </span>
              <span className="hidden w-24 sm:block">
                <Meter value={phase.weight_pct} max={35} color="#3b82f6" height="h-1.5" />
              </span>
              <span className="font-mono text-[10px] text-slate-400">{isOpen ? '−' : '+'}</span>
            </button>

            {isOpen ? (
              <div className="overflow-x-auto px-5 pb-4">
                <table className="w-full min-w-[520px] text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-[9.5px] uppercase tracking-wider text-slate-400">
                      <th className="py-1.5 pr-3 font-semibold">Task</th>
                      <th className="py-1.5 pr-3 font-semibold">Trade</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">Days</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">Crew</th>
                      <th className="py-1.5 font-semibold">Risk note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {phase.tasks.map((task) => (
                      <tr key={`${phase.phase}-${task.name}`} className="align-top">
                        <td className="py-2 pr-3 text-[12px] font-medium text-slate-800">{task.name}</td>
                        <td className="py-2 pr-3">
                          <Badge tone="slate">{titleCase(task.trade)}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-[11px] text-slate-600">{task.duration_days}</td>
                        <td className="py-2 pr-3 text-right font-mono text-[11px] text-slate-600">{task.crew}</td>
                        <td className="py-2 text-[11px] leading-relaxed text-slate-500">{task.risk_note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================== SIMPLE VIEW === */

/**
 * Plain-language wrapper around both commercial modules. Deliberately asks for the
 * smallest set of inputs that still produces a defensible number, then leads with the
 * answer. Everything the model actually computed is still reachable, one level down.
 */
function SimpleCommercial({ onRequireBackend }) {
  const [view, setView] = useState('value');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-soft">
        {[
          { id: 'value', label: 'What is it worth?', icon: CircleDollarSign },
          { id: 'time', label: 'How long will it take?', icon: CalendarRange },
        ].map((option) => {
          const Icon = option.icon;
          const active = view === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              aria-pressed={active}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-[13px] font-semibold transition ${
                active
                  ? 'bg-accent-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon size={16} strokeWidth={2.2} />
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>

      {view === 'value' ? <SimpleValuation onRequireBackend={onRequireBackend} /> : <SimplePlanning onRequireBackend={onRequireBackend} />}
    </div>
  );
}

function SimpleValuation({ onRequireBackend }) {
  const [form, setForm] = useState(DEFAULTS_VALUATION);
  const [showForm, setShowForm] = useState(true);

  const runValuation = useCallback((payload) => api.valuation(payload), []);
  const { data, error, loading, run } = useAsyncAction(runValuation);

  const set = (key) => (event) => {
    const raw = event?.target?.value;
    const numeric = ['super_builtup_area_sqft', 'age_years'].includes(key);
    setForm((current) => ({ ...current, [key]: numeric ? (raw === '' ? '' : Number(raw)) : raw }));
  };

  const submit = async (event) => {
    event?.preventDefault();
    const payload = {
      ...form,
      super_builtup_area_sqft: Number(form.super_builtup_area_sqft),
      age_years: Number(form.age_years) || 0,
      floor_number: Number(form.floor_number) || 0,
      floors_total: Number(form.floors_total) || 1,
      parking_slots: Number(form.parking_slots) || 0,
      ...(form.carpet_area_sqft ? { carpet_area_sqft: Number(form.carpet_area_sqft) } : {}),
      ...(form.monthly_rent_estimate ? { monthly_rent_estimate: Number(form.monthly_rent_estimate) } : {}),
    };
    const result = await run(payload);
    if (result) {
      setShowForm(false);
    } else {
      onRequireBackend?.();
    }
  };

  if (data) {
    const goodDrivers = data.drivers.filter((driver) => driver.impact_pct > 0.05);
    const badDrivers = data.drivers.filter((driver) => driver.impact_pct < -0.05);

    return (
      <div className="space-y-5">
        <StatusCard
          tone="good"
          icon="ok"
          eyebrow="Estimated value"
          headline={inr(data.estimated_value)}
          detail={`That is about ${inr(data.price_per_sqft)} per square foot for this ${plainProperty(form.property_type)}.`}
          meta={
            <>
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                Likely between {inr(data.range_low, { compact: true })} and {inr(data.range_high, { compact: true })}
              </span>
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                {num(data.area_basis_sqft)} sqft
              </span>
            </>
          }
          action={
            <Button variant="secondary" onClick={() => setShowForm(true)} className="!rounded-xl">
              Change the details
            </Button>
          }
        />

        <FactGrid
          facts={[
            {
              label: 'Price per sqft',
              value: inr(data.price_per_sqft),
              sub: `base rate ${inr(data.base_rate_per_sqft)}`,
              icon: Ruler,
            },
            {
              label: 'Monthly rent if let out',
              value: data.rental_yield_pct != null ? inr(Math.round((data.estimated_value * data.rental_yield_pct) / 100 / 12)) : '—',
              sub: data.rental_yield_pct != null ? `${data.rental_yield_pct}% a year` : 'not enough rent data',
              icon: Percent,
            },
            {
              label: 'How sure we are',
              value: titleCase(data.confidence_label.replace('_', ' ')),
              sub: `${Math.round(data.confidence * 100)} out of 100`,
              icon: ChartNoAxesColumn,
              tone: data.confidence >= 0.65 ? 'good' : 'watch',
            },
          ]}
        />

        <Disclosure
          title="View detailed breakdown"
          subtitle="What pushed the price up or down, and how the estimate was built."
        >
          <div className="space-y-5">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                What raised the price
              </p>
              {goodDrivers.length ? (
                <ul className="mt-2 space-y-2">
                  {goodDrivers.map((driver) => (
                    <li key={driver.label} className="flex items-start justify-between gap-3 rounded-xl bg-emerald-50/70 px-3 py-2.5">
                      <span className="min-w-0 text-[12.5px] leading-snug text-slate-700">
                        <span className="font-semibold text-slate-900">{driver.label}</span>
                        <br />
                        {firstSentence(plainRewrite(driver.explanation), 140)}
                      </span>
                      <span className="shrink-0 font-mono text-[12px] font-semibold text-emerald-700">
                        +{driver.impact_pct.toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[12.5px] text-slate-500">Nothing pushed the price up significantly.</p>
              )}
            </div>

            {badDrivers.length ? (
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  What pulled it down
                </p>
                <ul className="mt-2 space-y-2">
                  {badDrivers.map((driver) => (
                    <li key={driver.label} className="flex items-start justify-between gap-3 rounded-xl bg-red-50/70 px-3 py-2.5">
                      <span className="min-w-0 text-[12.5px] leading-snug text-slate-700">
                        <span className="font-semibold text-slate-900">{driver.label}</span>
                        <br />
                        {firstSentence(plainRewrite(driver.explanation), 140)}
                      </span>
                      <span className="shrink-0 font-mono text-[12px] font-semibold text-red-700">
                        {driver.impact_pct.toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-xl bg-slate-50 p-3.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                How we worked it out
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{data.methodology}</p>
            </div>

            {data.risk_flags.length ? (
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Things that could change this
                </p>
                <ul className="mt-2 space-y-1.5">
                  {data.risk_flags.map((flag) => (
                    <li key={flag} className="flex gap-2 text-[12.5px] leading-relaxed text-slate-600">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      {flag}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <EngineFooter engine={data.engine} />
          </div>
        </Disclosure>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
        <h2 className="text-base font-semibold tracking-tight text-slate-900">
          Tell us about the property
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          Four details are enough for a realistic estimate. You can change them and recalculate as often as you like.
        </p>

        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City">
              <TextInput value={form.city} onChange={set('city')} placeholder="Indore" />
            </Field>
            <Field label="Area (locality)" hint="optional">
              <TextInput value={form.locality} onChange={set('locality')} placeholder="Vijay Nagar" />
            </Field>
          </div>

          <Field label="What kind of property?">
            <Select options={PROPERTY_TYPES} value={form.property_type} onChange={set('property_type')} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Built-up area" hint="sqft">
              <TextInput
                type="number"
                min="100"
                inputMode="numeric"
                value={form.super_builtup_area_sqft}
                onChange={set('super_builtup_area_sqft')}
              />
            </Field>
            <Field label="How old is it?" hint="years">
              <TextInput type="number" min="0" max="120" value={form.age_years} onChange={set('age_years')} />
            </Field>
          </div>

          <Field label="Quality of finishes">
            <Select options={FINISH} value={form.finish_grade} onChange={set('finish_grade')} />
          </Field>

          <Disclosure title="More details (optional)" subtitle="Floors, parking and amenities make the estimate sharper.">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Floor number">
                  <TextInput
                    type="number"
                    value={form.floor_number}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, floor_number: Number(event.target.value) }))
                    }
                  />
                </Field>
                <Field label="Total floors">
                  <TextInput
                    type="number"
                    min="1"
                    value={form.floors_total}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, floors_total: Number(event.target.value) }))
                    }
                  />
                </Field>
              </div>
              <Field label="Parking spaces">
                <TextInput
                  type="number"
                  min="0"
                  max="20"
                  value={form.parking_slots}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, parking_slots: Number(event.target.value) }))
                  }
                />
              </Field>
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-700">Amenities</p>
                <div className="flex flex-wrap gap-1.5">
                  {AMENITIES.map((amenity) => (
                    <Chip
                      key={amenity}
                      active={form.amenities.includes(amenity)}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          amenities: current.amenities.includes(amenity)
                            ? current.amenities.filter((item) => item !== amenity)
                            : [...current.amenities, amenity],
                        }))
                      }
                    >
                      {titleCase(amenity)}
                    </Chip>
                  ))}
                </div>
              </div>
              <Field label="Monthly rent you could get" hint="optional">
                <TextInput
                  type="number"
                  min="0"
                  value={form.monthly_rent_estimate}
                  onChange={set('monthly_rent_estimate')}
                />
              </Field>
            </div>
          </Disclosure>
        </div>

        {error ? <ErrorState error={error} onRetry={submit} /> : null}

        <Button
          type="submit"
          loading={loading}
          size="lg"
          icon={CircleDollarSign}
          className="mt-5 w-full !rounded-xl !py-3 text-[15px]"
        >
          {loading ? 'Working out the value…' : 'Tell me what it is worth'}
        </Button>
      </section>
    </form>
  );
}

function SimplePlanning({ onRequireBackend }) {
  const [form, setForm] = useState(DEFAULTS_PLAN);

  const runPlan = useCallback((payload) => api.plan(payload), []);
  const { data, error, loading, run } = useAsyncAction(runPlan);

  const set = (key) => (event) => {
    const raw = event?.target?.value;
    const numeric = ['total_area_sqft', 'floors', 'units'];
    setForm((current) => ({ ...current, [key]: numeric ? (raw === '' ? '' : Number(raw)) : raw }));
  };

  const submit = async (event) => {
    event?.preventDefault();
    const payload = {
      ...form,
      total_area_sqft: Number(form.total_area_sqft),
      floors: Number(form.floors),
      units: Number(form.units),
    };
    const result = await run(payload);
    if (result === undefined) onRequireBackend?.();
  };

  const health = data ? HEALTH_TONE[data.schedule_health] : null;

  return (
    <div className="space-y-5">
      {data ? (
        <>
          <StatusCard
            tone={health.tone === 'green' ? 'good' : health.tone === 'amber' ? 'watch' : 'act'}
            icon={health.tone === 'green' ? 'ok' : 'warning'}
            eyebrow="Project timeline"
            headline={`Finished by ${monthYear(data.computed_end_date)}`}
            detail={`${plainDuration(data.total_duration_days)} of work, starting ${monthYear(data.computed_start_date)}.${
              data.buffer_days ? ` A ${data.buffer_days}-day cushion is already included for rain and delays.` : ''
            }`}
            meta={
              <>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  {data.schedule_health === 'on_track' ? 'Realistic timeline' : `${health.label} timeline`}
                </span>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  {data.floors ?? form.floors} floors · {num(form.total_area_sqft)} sqft
                </span>
              </>
            }
          />

          <FactGrid
            facts={[
              {
                label: 'Work starts',
                value: monthYear(data.computed_start_date),
                sub: humanDate(data.computed_start_date),
                icon: CalendarRange,
              },
              {
                label: 'Handover',
                value: monthYear(data.computed_end_date),
                sub: humanDate(data.computed_end_date),
                icon: Flag,
              },
              {
                label: 'People on site at peak',
                value: `${data.resources.peak_crew}`,
                sub: 'workers at the busiest stage',
                icon: Users,
              },
            ]}
          />

          <SimpleTimeline milestones={data.milestones} />

          <Disclosure
            title="View detailed breakdown"
            subtitle="Full task list, materials, risks and the programme narrative."
          >
            <div className="space-y-5">
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Main stages
                </p>
                <ul className="mt-2 space-y-2">
                  {data.phase_breakdown.map((phase) => (
                    <li key={phase.phase} className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-semibold text-slate-900">{plainPhase(phase.phase)}</span>
                        <span className="font-mono text-[10.5px] text-slate-500">{phase.window_label}</span>
                      </div>
                      <p className="mt-0.5 text-[11.5px] text-slate-500">
                        {phase.tasks.length} tasks · {Math.round(phase.weight_pct)}% of the work
                      </p>
                      <ul className="mt-1.5 space-y-0.5">
                        {phase.tasks.slice(0, 4).map((task) => (
                          <li key={task.name} className="text-[11.5px] leading-relaxed text-slate-600">
                            • {task.name} — {task.duration_days} days, {task.crew} people
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Materials you will need
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[15px] font-bold text-slate-900">{num(data.resources.concrete_m3_est, 0)}</p>
                    <p className="text-[10.5px] text-slate-500">m³ concrete</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[15px] font-bold text-slate-900">{num(data.resources.steel_tonnes_est, 1)}</p>
                    <p className="text-[10.5px] text-slate-500">tonnes steel</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[15px] font-bold text-slate-900">{num(data.resources.labour_days ?? data.resources.total_labour_days, 0)}</p>
                    <p className="text-[10.5px] text-slate-500">worker-days</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  What could go wrong
                </p>
                <ul className="mt-2 space-y-2">
                  {data.risks.map((risk) => (
                    <li key={risk.id} className="rounded-xl border border-slate-100 px-3 py-2.5">
                      <p className="text-[12.5px] font-semibold leading-snug text-slate-900">{risk.title}</p>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-600">{risk.mitigation}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl bg-slate-50 p-3.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Planner&apos;s note
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{data.narrative}</p>
              </div>

              <EngineFooter engine={data.engine} />
            </div>
          </Disclosure>

          <div className="flex flex-wrap items-center justify-center gap-2 pb-2">
            <Button variant="secondary" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="!rounded-xl">
              Change the project details
            </Button>
          </div>
        </>
      ) : null}

      <form
        onSubmit={submit}
        className={`space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6 ${
          data ? 'order-first' : ''
        }`}
      >
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">
            {data ? 'Adjust the project' : 'Describe your project'}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            We turn this into a dated plan: which stage happens when, and when the building is ready.
          </p>
        </div>

        <div className="space-y-4">
          <Field label="Project name">
            <TextInput value={form.project_name} onChange={set('project_name')} placeholder="Indore Trade Centre" />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City">
              <TextInput value={form.city} onChange={set('city')} />
            </Field>
            <Field label="What are you building?">
              <Select options={PROPERTY_TYPES} value={form.project_type} onChange={set('project_type')} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Total built-up area" hint="sqft">
              <TextInput
                type="number"
                min="500"
                inputMode="numeric"
                value={form.total_area_sqft}
                onChange={set('total_area_sqft')}
              />
            </Field>
            <Field label="Number of floors">
              <TextInput type="number" min="1" max="80" value={form.floors} onChange={set('floors')} />
            </Field>
          </div>

          <Field label="When can work start?">
            <TextInput type="date" value={form.start_date} onChange={set('start_date')} />
          </Field>

          <Disclosure title="More details (optional)" subtitle="Units, structure and procurement method.">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Units / shops">
                  <TextInput type="number" min="1" value={form.units} onChange={set('units')} />
                </Field>
                <Field label="Structure">
                  <Select options={STRUCTURE} value={form.structure_type} onChange={set('structure_type')} />
                </Field>
              </div>
              <Field label="How is it contracted?">
                <Select options={PROCUREMENT} value={form.procurement_mode} onChange={set('procurement_mode')} />
              </Field>
            </div>
          </Disclosure>
        </div>

        {error ? <ErrorState error={error} onRetry={submit} /> : null}

        <Button
          type="submit"
          loading={loading}
          size="lg"
          icon={CalendarCheck}
          className="w-full !rounded-xl !py-3 text-[15px]"
        >
          {loading ? 'Building the plan…' : data ? 'Update the plan' : 'Show me the timeline'}
        </Button>
      </form>
    </div>
  );
}

/** Vertical, plain-language milestone list — reads like a project calendar, not a Gantt. */
function SimpleTimeline({ milestones }) {
  const current = useMemo(() => {
    const now = Date.now();
    return milestones.find((milestone) => new Date(`${milestone.end_date}T00:00:00`).getTime() > now) ?? null;
  }, [milestones]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-50 text-accent-700">
          <CalendarRange size={16} />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">Stage by stage</h3>
          <p className="text-[11.5px] text-slate-500">In order of when they happen on site.</p>
        </div>
      </div>

      <ol className="mt-4 space-y-0">
        {milestones.map((milestone, index) => {
          const isNext = current && current.id === milestone.id;
          const done = new Date(`${milestone.end_date}T00:00:00`).getTime() < Date.now();
          const last = index === milestones.length - 1;
          return (
            <li key={milestone.id} className="relative flex gap-3 pb-4 last:pb-0">
              {!last ? (
                <span
                  aria-hidden
                  className={`absolute left-[11px] top-6 h-full w-px ${done ? 'bg-emerald-200' : 'bg-slate-200'}`}
                />
              ) : null}
              <span
                className={`relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ring-4 ring-white ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : isNext
                      ? 'bg-accent-600 text-white'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? '✓' : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-[13px] font-semibold leading-snug text-slate-900">
                    {plainPhase(milestone.phase)}
                  </p>
                  <p className="font-mono text-[10.5px] text-slate-400">{shortDate(milestone.start_date)}</p>
                </div>
                <p className="mt-0.5 text-[11.5px] text-slate-500">
                  {milestone.duration_days} working days · {milestone.crew_size} people on site
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
        <MapPin size={13} className="shrink-0 text-slate-400" />
        <p className="text-[11.5px] leading-relaxed text-slate-600">
          Dates are working days only and already allow for monsoon slowdowns. Confirm locally before
          committing to a buyer.
        </p>
      </div>

      <ExpertOnly hint="Critical path analysis, trade-wise task tables and resource quantities are available in Expert View." />
    </section>
  );
}
