/** Presentation helpers: severity theming, currency, dates, labels. */

export const SEVERITY = {
  low: {
    label: 'Low',
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
    ring: 'ring-emerald-500/30',
    hex: '#10b981',
  },
  medium: {
    label: 'Medium',
    text: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    ring: 'ring-amber-500/30',
    hex: '#f59e0b',
  },
  high: {
    label: 'High',
    text: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    dot: 'bg-orange-500',
    bar: 'bg-orange-500',
    ring: 'ring-orange-500/30',
    hex: '#f97316',
  },
  critical: {
    label: 'Critical',
    text: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    dot: 'bg-red-500',
    bar: 'bg-red-500',
    ring: 'ring-red-500/30',
    hex: '#ef4444',
  },
};

export const PERMIT = {
  go: { label: 'Go', ...SEVERITY.low },
  caution: { label: 'Caution', ...SEVERITY.medium },
  hold: { label: 'Hold', ...SEVERITY.critical },
};

export const severityStyle = (value) => SEVERITY[String(value || 'low').toLowerCase()] || SEVERITY.low;
export const permitStyle = (value) => PERMIT[String(value || 'go').toLowerCase()] || PERMIT.go;

export const inr = (value, { compact = false } = {}) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  if (compact) {
    const n = Number(value);
    if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
    if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
    if (Math.abs(n) >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value));
};

export const num = (value, digits = 0) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? '—'
    : Number(value).toLocaleString('en-IN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

export const pct = (value, digits = 1) =>
  value === null || value === undefined ? '—' : `${Number(value).toFixed(digits)}%`;

export const humanDate = (value) => {
  if (!value) return '—';
  const d = new Date(`${value}`.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const shortDate = (value) => {
  if (!value) return '—';
  const d = new Date(`${value}`.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export const clockTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};

export const titleCase = (value) =>
  String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const bytes = (value) => {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

/** Clamp helper used by gauges and bars. */
export const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Number(v) || 0));

/** Risk colour ramp for a 0-100 score where higher = worse. */
export const riskRamp = (score) => {
  const s = clamp(score);
  if (s >= 78) return '#ef4444';
  if (s >= 55) return '#f97316';
  if (s >= 32) return '#f59e0b';
  return '#10b981';
};
