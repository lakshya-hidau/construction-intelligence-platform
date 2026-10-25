import { useCallback, useEffect, useState } from 'react';
import {
  CloudRain,
  CloudSun,
  Compass,
  Droplets,
  Gauge,
  ListChecks,
  MapPin,
  RefreshCw,
  Sun,
  Thermometer,
  TriangleAlert,
  Waves,
  Wind,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAsyncAction } from '../hooks/useAsync';
import { useViewMode } from '../lib/viewMode';
import { clockTime, humanDate, pct, severityStyle, titleCase } from '../lib/format';
import {
  firstSentence,
  plainActivity,
  plainRewrite,
  plainSentence,
  toneFor,
  weatherStatus,
} from '../lib/plainEnglish';
import StatusCard, { FactGrid } from './ui/StatusCard';
import Disclosure from './ui/Disclosure';
import { ExpertOnly } from './ui/ViewModeToggle';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EngineFooter,
  ErrorState,
  Field,
  PermitPill,
  SectionTitle,
  Select,
  SkeletonBlock,
  StatTile,
  TextInput,
} from './ui/Primitives';

const ACTIVITIES = [
  { value: 'concrete_pour', label: 'Concrete pouring' },
  { value: 'excavation', label: 'Excavation / earthwork' },
  { value: 'masonry', label: 'Masonry & plaster' },
  { value: 'steel_erection', label: 'Steel erection' },
  { value: 'waterproofing', label: 'Waterproofing' },
  { value: 'painting', label: 'Painting' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'general_site', label: 'General site works' },
];

const CITIES = ['Indore', 'Bhopal', 'Pune', 'Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Ahmedabad', 'Jaipur', 'Chennai', 'Kolkata', 'Nagpur'];

const HEAT_LABEL = {
  normal: { tone: 'green', label: 'Normal' },
  caution: { tone: 'green', label: 'Caution' },
  extreme_caution: { tone: 'amber', label: 'Extreme caution' },
  danger: { tone: 'red', label: 'Danger' },
  extreme_danger: { tone: 'red', label: 'Extreme danger' },
};

export default function WeatherAdvisory({ onRequireBackend }) {
  const { isExpert } = useViewMode();
  if (isExpert) return <ExpertWeather onRequireBackend={onRequireBackend} />;
  return <SimpleWeather onRequireBackend={onRequireBackend} />;
}

function ExpertWeather({ onRequireBackend }) {
  const [city, setCity] = useState('Indore');
  const [activity, setActivity] = useState('concrete_pour');

  const fetchAdvisory = useCallback((c, a) => api.weatherAdvisory({ city: c, activity: a }), []);
  const { data, error, loading, run } = useAsyncAction(fetchAdvisory);

  const load = useCallback(
    async (c = city, a = activity) => {
      const result = await run(c, a);
      if (result === undefined && onRequireBackend) onRequireBackend();
    },
    [run, city, activity, onRequireBackend],
  );

  useEffect(() => {
    load('Indore', 'concrete_pour');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const w = data?.current;
  const heat = data ? HEAT_LABEL[data.heat_stress_category] : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={CloudSun}
          title="Weather-aware site advisory"
          subtitle="Live conditions translated into a permit status, work windows and trade-specific controls."
          action={
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => load()} loading={loading}>
              Refresh
            </Button>
          }
        />
        <div className="grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Site city">
            <TextInput value={city} onChange={(e) => setCity(e.target.value)} placeholder="Indore" list="city-list" />
            <datalist id="city-list">
              {CITIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Planned activity">
            <Select options={ACTIVITIES} value={activity} onChange={(e) => setActivity(e.target.value)} />
          </Field>
          <Button onClick={() => load(city, activity)} loading={loading} className="h-10">
            Update advisory
          </Button>
        </div>
        {error ? (
          <div className="px-5 pb-5">
            <ErrorState error={error} onRetry={() => load()} />
          </div>
        ) : null}
      </Card>

      {loading && !data ? (
        <Card className="space-y-4 p-5">
          <SkeletonBlock lines={2} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
          <SkeletonBlock lines={5} />
        </Card>
      ) : null}

      {data ? (
        <div className="animate-fade-up space-y-4">
          <Card>
            <CardHeader
              icon={Compass}
              title={data.location_label}
              subtitle={`${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)} · observed ${clockTime(w.observed_at)}`}
              action={<PermitPill value={data.permit_status} />}
            />

            <div className={`mx-5 mt-5 rounded-lg border p-3.5 ${severityStyle(data.permit_status === 'hold' ? 'critical' : data.permit_status === 'caution' ? 'medium' : 'low').bg} ${severityStyle(data.permit_status === 'hold' ? 'critical' : data.permit_status === 'caution' ? 'medium' : 'low').border}`}>
              <p className="text-[13px] font-semibold text-slate-800">{data.permit_headline}</p>
              <p className="mt-0.5 text-[11px] text-slate-600">
                Assessed for <strong>{titleCase(data.activity)}</strong>
                {data.data_source === 'simulated' ? ' · simulated weather (live provider unavailable)' : ' · live Open-Meteo data'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 p-5 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile
                label="Temperature"
                value={`${w.temperature_c}°`}
                sub={`feels ${w.feels_like_c}°C`}
                icon={Thermometer}
                tone={w.temperature_c >= 38 ? 'red' : w.temperature_c >= 33 ? 'amber' : 'slate'}
              />
              <StatTile label="Humidity" value={pct(w.humidity_pct, 0)} sub="relative" icon={Droplets} />
              <StatTile
                label="Rain now"
                value={`${w.precipitation_mm}mm`}
                sub={`${w.precipitation_probability_pct}% chance`}
                icon={CloudRain}
                tone={w.precipitation_mm >= 2 ? 'blue' : 'slate'}
              />
              <StatTile
                label="Wind"
                value={`${Math.round(w.wind_kph)}`}
                sub={`gusts ${Math.round(w.gust_kph)} km/h`}
                icon={Wind}
                tone={w.gust_kph >= 60 ? 'red' : w.wind_kph >= 30 ? 'amber' : 'slate'}
              />
              <StatTile label="UV index" value={w.uv_index} sub={w.uv_index >= 8 ? 'very high' : w.uv_index >= 6 ? 'high' : 'moderate'} icon={Sun} />
              <StatTile
                label="Heat stress"
                value={heat.label}
                sub={data.heat_stress_category.replace(/_/g, ' ')}
                icon={Gauge}
                tone={heat.tone === 'red' ? 'red' : heat.tone === 'amber' ? 'amber' : 'green'}
              />
            </div>

            <div className="border-t border-slate-200 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone={data.concrete_pour_suitable ? 'green' : 'red'} icon={Gauge}>
                  Concrete pour: {data.concrete_pour_suitable ? 'permitted' : 'not permitted'}
                </Badge>
                <Badge tone="slate">{w.condition}</Badge>
                <Badge tone={data.data_source === 'open-meteo' ? 'blue' : 'amber'}>
                  Source: {data.data_source}
                </Badge>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={TriangleAlert} title="Construction advisories" subtitle="Trade-specific controls derived from the current conditions" />
            <ul className="divide-y divide-slate-100">
              {data.advisories.map((a) => {
                const s = severityStyle(a.severity);
                return (
                  <li key={a.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                      <Badge tone="slate">{titleCase(a.category)}</Badge>
                      <Badge tone={a.severity === 'critical' ? 'red' : a.severity === 'high' ? 'amber' : a.severity === 'medium' ? 'amber' : 'green'}>
                        {titleCase(a.severity)}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-900">{a.headline}</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{a.detail}</p>
                    <ul className="mt-2 space-y-1">
                      {a.actions.map((action) => (
                        <li key={action} className="flex gap-2 text-[11.5px] leading-relaxed text-slate-600">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                          {action}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 font-mono text-[10px] text-slate-400">{a.standard_reference}</p>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader icon={Sun} title="Work windows" subtitle="When to schedule which activity today" />
              <ul className="divide-y divide-slate-100">
                {data.work_windows.map((win) => (
                  <li key={win.label} className="flex items-start gap-3 px-5 py-3">
                    <span className="w-16 shrink-0 font-mono text-[11px] text-slate-500">
                      {String(win.start_hour).padStart(2, '0')}:00–
                      <br />
                      {String(win.end_hour).padStart(2, '0')}:00
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-slate-800">{win.label}</span>
                      <span className="block text-[11px] leading-relaxed text-slate-500">{win.reason}</span>
                    </span>
                    <PermitPill value={win.suitability} />
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader icon={CloudRain} title="7-day outlook" subtitle="Workability by day" />
              <ul className="divide-y divide-slate-100">
                {data.forecast.map((day) => (
                  <li key={day.day} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="w-20 shrink-0 text-[11.5px] font-medium text-slate-700">
                      {humanDate(day.day).slice(0, 6)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] text-slate-600">{day.condition}</span>
                      <span className="block font-mono text-[9.5px] text-slate-400">
                        {Math.round(day.temp_min_c)}° – {Math.round(day.temp_max_c)}° · {day.precipitation_mm}mm ·{' '}
                        {Math.round(day.wind_max_kph)} km/h
                      </span>
                    </span>
                    <PermitPill value={day.workability} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="p-5">
            <SectionTitle>Data provenance</SectionTitle>
            <EngineFooter engine={data.engine} />
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================== SIMPLE VIEW === */

const PLAIN_ACTIVITIES = [
  { value: 'concrete_pour', label: 'Pouring concrete' },
  { value: 'excavation', label: 'Digging / earthwork' },
  { value: 'masonry', label: 'Brickwork and plaster' },
  { value: 'steel_erection', label: 'Steel work' },
  { value: 'waterproofing', label: 'Waterproofing' },
  { value: 'painting', label: 'Painting' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'general_site', label: 'General site work' },
];

const PLAIN_HEAT = {
  normal: { label: 'Comfortable', tone: 'good' },
  caution: { label: 'Warm', tone: 'good' },
  extreme_caution: { label: 'Very hot', tone: 'watch' },
  danger: { label: 'Dangerously hot', tone: 'act' },
  extreme_danger: { label: 'Dangerously hot', tone: 'act' },
};

/** "Is it safe to work today?" — one question, one answer, then the actions. */
function SimpleWeather({ onRequireBackend }) {
  const [city, setCity] = useState('Indore');
  const [activity, setActivity] = useState('concrete_pour');

  const fetchAdvisory = useCallback((c, a) => api.weatherAdvisory({ city: c, activity: a }), []);
  const { data, error, loading, run } = useAsyncAction(fetchAdvisory);

  const load = useCallback(
    async (c = city, a = activity) => {
      const result = await run(c, a);
      if (result === undefined) onRequireBackend?.();
    },
    [run, city, activity, onRequireBackend],
  );

  useEffect(() => {
    load('Indore', 'concrete_pour');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const w = data?.current;
  const status = data ? weatherStatus(data) : null;
  const heat = data ? PLAIN_HEAT[data.heat_stress_category] : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">What are you doing today?</h2>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
          We check the weather where you are and tell you whether that work is safe.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.2fr_auto] sm:items-end">
          <Field label="Site city">
            <TextInput
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Indore"
              list="simple-city-list"
            />
            <datalist id="simple-city-list">
              {CITIES.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </Field>
          <Field label="Today's work">
            <Select
              options={PLAIN_ACTIVITIES}
              value={activity}
              onChange={(event) => setActivity(event.target.value)}
            />
          </Field>
          <Button
            onClick={() => load(city, activity)}
            loading={loading}
            icon={RefreshCw}
            className="h-10 !rounded-xl"
          >
            Check
          </Button>
        </div>

        {error ? (
          <div className="mt-4">
            <ErrorState error={error} onRetry={() => load()} />
          </div>
        ) : null}
      </section>

      {loading && !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <SkeletonBlock lines={2} />
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        </div>
      ) : null}

      {data ? (
        <div className="animate-fade-up space-y-5">
          <StatusCard
            tone={status.tone.key}
            icon={status.icon}
            headline={status.headline}
            detail={status.detail}
            meta={
              <>
                <span className="flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  <MapPin size={10} /> {data.location_label.split(',').slice(0, 2).join(',')}
                </span>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  For {plainActivity(data.activity)}
                </span>
              </>
            }
          />

          {w ? (
            <FactGrid
              facts={[
                {
                  label: 'Temperature',
                  value: `${Math.round(w.temperature_c)}°C`,
                  sub: `feels like ${Math.round(w.feels_like_c)}°C · ${heat.label.toLowerCase()}`,
                  icon: Thermometer,
                  tone: heat.tone,
                },
                {
                  label: 'Rain',
                  value: w.precipitation_mm > 0 ? `${w.precipitation_mm} mm` : 'None right now',
                  sub: `${w.precipitation_probability_pct}% chance in the next few hours`,
                  icon: w.precipitation_mm > 0 ? CloudRain : Waves,
                },
                {
                  label: 'Wind',
                  value: `${Math.round(w.wind_kph)} km/h`,
                  sub: `gusts up to ${Math.round(w.gust_kph)} km/h`,
                  icon: Wind,
                  tone: w.gust_kph >= 60 ? 'act' : w.wind_kph >= 30 ? 'watch' : 'good',
                },
              ]}
            />
          ) : null}

          <SimpleWeatherActions advisories={data.advisories} />

          <Disclosure
            title="Best time to work today"
            subtitle="Which hours suit your work, and what high heat means for the crew."
          >
            <ul className="space-y-2">
              {data.work_windows.map((window) => {
                const tone = toneFor(window.suitability === 'go' ? 'good' : window.suitability === 'caution' ? 'watch' : 'act');
                return (
                  <li key={window.label} className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                    <span className="mt-0.5 w-16 shrink-0 font-mono text-[11px] font-semibold text-slate-600">
                      {String(window.start_hour).padStart(2, '0')}:00
                      <br />
                      {String(window.end_hour).padStart(2, '0')}:00
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold text-slate-900">{window.label}</span>
                      <span className="block text-[11.5px] leading-relaxed text-slate-600">{window.reason}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${tone.chip}`}>
                      {window.suitability === 'go' ? 'Good' : window.suitability === 'caution' ? 'Careful' : 'Avoid'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Disclosure>

          <Disclosure title="Next 7 days" subtitle="Which days look workable for what you are doing.">
            <ul className="divide-y divide-slate-100">
              {data.forecast.map((day) => {
                const tone = toneFor(day.workability === 'go' ? 'good' : day.workability === 'caution' ? 'watch' : 'act');
                return (
                  <li key={day.day} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="w-16 shrink-0 text-[11.5px] font-medium text-slate-700">
                      {humanDate(day.day).slice(0, 3)}
                    </span>
                    <span className="min-w-0 flex-1 text-[11.5px] text-slate-600">
                      {day.condition} · {Math.round(day.temp_min_c)}°–{Math.round(day.temp_max_c)}°
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${tone.chip}`}>
                      {day.workability === 'go' ? 'Good' : day.workability === 'caution' ? 'Careful' : 'Avoid'}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] leading-relaxed text-slate-500">
                {data.data_source === 'simulated'
                  ? 'Live weather was unavailable, so these figures are simulated for planning only.'
                  : 'Weather from Open-Meteo, updated when you press Check.'}
              </p>
            </div>
          </Disclosure>

          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-center shadow-soft">
            <p className="text-[12px] leading-relaxed text-slate-500">
              Weather decisions still belong to your site engineer. Use this as a prompt, not a permission slip.
            </p>
            <ExpertOnly hint="Raw weather readings, heat-stress index and trade citations are available in Expert View." />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SimpleWeatherActions({ advisories = [] }) {
  const ordered = [...advisories].sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4);
  });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-50 text-accent-700">
          <ListChecks size={16} />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">What to do about it</h3>
          <p className="text-[11.5px] text-slate-500">Most important first.</p>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {ordered.slice(0, 4).map((advisory) => {
          const tone = toneFor(
            advisory.severity === 'critical' || advisory.severity === 'high'
              ? 'act'
              : advisory.severity === 'medium'
                ? 'watch'
                : 'good',
          );
          return (
            <li key={advisory.id} className={`rounded-xl border px-3.5 py-3 ${tone.card}`}>
              <div className="flex items-start gap-2.5">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone.solid}`} />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-snug text-slate-900">{plainRewrite(advisory.headline)}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600">
                    {plainSentence(advisory.detail, 170)}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {advisory.actions
                      .map(plainRewrite)
                      // The engine often repeats the summary line as the first action; showing it
                      // twice reads like a bug, so drop bullets the sentence already covers.
                      .filter((action) => {
                        const detail = plainSentence(advisory.detail, 170).toLowerCase();
                        return !detail.includes(action.toLowerCase().replace(/\.$/, ''));
                      })
                      .slice(0, 3)
                      .map((action) => (
                        <li key={action} className="text-[11.5px] leading-relaxed text-slate-600">
                          • {action}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            </li>
          );
        })}
        {ordered.length > 4 ? (
          <li className="text-[11.5px] text-slate-500">
            + {ordered.length - 4} more note{ordered.length - 4 === 1 ? '' : 's'} in Expert View.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
