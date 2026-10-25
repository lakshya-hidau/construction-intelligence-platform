/**
 * Translation layer between machine output and human meaning.
 *
 * Simple View is not "the same screen with smaller words" — it is a different reading of
 * the same payload. Everything here converts an enum, a score or a clause reference into
 * a sentence a site owner can act on, and maps it onto one of three emotional tones:
 *
 *   good  →  green   "this is fine"
 *   watch →  amber   "look at this soon"
 *   act   →  red     "do something before work continues"
 *
 * Expert View ignores all of this and reads the raw contract fields directly.
 */

import { clamp } from './format';

/* ------------------------------------------------------------------ tones ------ */

export const TONES = {
  good: {
    key: 'good',
    label: 'All clear',
    card: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white',
    solid: 'bg-emerald-500',
    soft: 'bg-emerald-100',
    text: 'text-emerald-900',
    muted: 'text-emerald-700',
    ring: 'ring-emerald-200',
    bar: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  watch: {
    key: 'watch',
    label: 'Keep an eye on it',
    card: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white',
    solid: 'bg-amber-500',
    soft: 'bg-amber-100',
    text: 'text-amber-900',
    muted: 'text-amber-700',
    ring: 'ring-amber-200',
    bar: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  act: {
    key: 'act',
    label: 'Action needed',
    card: 'border-red-200 bg-gradient-to-br from-red-50 to-white',
    solid: 'bg-red-500',
    soft: 'bg-red-100',
    text: 'text-red-900',
    muted: 'text-red-700',
    ring: 'ring-red-200',
    bar: 'bg-red-500',
    chip: 'bg-red-50 text-red-700 ring-red-200',
  },
};

export const toneFor = (key) => TONES[key] || TONES.watch;

/* ------------------------------------------------------------------ safety ----- */

const RISK_TO_TONE = { low: 'good', medium: 'watch', high: 'act', critical: 'act' };

/** Headline verdict for a safety analysis, in plain language. */
export function safetyStatus(data) {
  const hazards = data?.hazards ?? [];
  const serious = hazards.filter((h) => h.severity === 'critical' || h.severity === 'high');
  const tone = toneFor(data?.stop_work_recommended ? 'act' : RISK_TO_TONE[data?.overall_risk] || 'watch');

  if (data?.stop_work_recommended) {
    return {
      tone,
      icon: 'stop',
      headline: 'Stop work in this area',
      detail: 'Someone could be seriously hurt. Fix the problem below before the crew carries on.',
      cta: 'What to fix first',
    };
  }
  if (data?.overall_risk === 'low' && serious.length === 0) {
    return {
      tone,
      icon: 'ok',
      headline: 'This area looks safe',
      detail: 'We did not spot anyone missing protective gear or working near an open edge.',
      cta: 'What to keep doing',
    };
  }
  if (data?.overall_risk === 'high' || data?.overall_risk === 'critical') {
    return {
      tone,
      icon: 'warning',
      headline: 'This area needs attention',
      detail: `${hazards.length === 1 ? 'One problem was' : `${hazards.length} problems were`} found. Sort them out before the next shift starts.`,
      cta: 'What to fix first',
    };
  }
  return {
    tone,
    icon: 'warning',
    headline: 'A few things to tidy up',
    detail: 'Nothing urgent, but a supervisor should walk this area today.',
    cta: 'What to fix first',
  };
}

const PPE_NOUN = {
  helmet: { one: 'safety helmet', many: 'safety helmets' },
  hi_vis_vest: { one: 'hi-vis jacket', many: 'hi-vis jackets' },
  harness: { one: 'safety harness', many: 'safety harnesses' },
  safety_boots: { one: 'pair of safety boots', many: 'pairs of safety boots' },
  eye_protection: { one: 'pair of safety glasses', many: 'pairs of safety glasses' },
  gloves: { one: 'pair of gloves', many: 'pairs of gloves' },
};

/** "2 of 4 people are not wearing safety helmets" — no percentages, no weighting. */
export function ppeSentences(ppe = []) {
  return ppe
    .filter((item) => item.violations > 0)
    .map((item) => {
      const noun = PPE_NOUN[item.kind] || { one: 'item of safety gear', many: 'items of safety gear' };
      const word = item.violations === 1 ? noun.one : noun.many;
      const people = item.workers_checked;
      return {
        kind: item.kind,
        tone: item.violations / Math.max(people, 1) >= 0.5 ? 'act' : 'watch',
        text: `${item.violations} of ${people} ${people === 1 ? 'person is' : 'people are'} not wearing ${word}`,
        compliant: people - item.violations,
        checked: people,
        violations: item.violations,
      };
    });
}

/* ------------------------------------------------------------------ cracks ----- */

const CRACK_TONE = { low: 'good', medium: 'watch', critical: 'act' };

export function crackStatus(data) {
  const tone = toneFor(CRACK_TONE[data?.severity] || 'watch');

  if (data?.crack_type === 'none_observed') {
    return {
      tone: toneFor('good'),
      icon: 'ok',
      headline: 'No serious crack visible',
      detail: 'The surface looks sound in this photo. Take another photo later if it changes.',
      cta: 'What to do next',
    };
  }
  if (data?.severity === 'critical') {
    return {
      tone,
      icon: 'stop',
      headline: 'Get an engineer to look at this',
      detail: 'This crack pattern can mean the structure is overloaded. Do not cover it up or plaster over it yet.',
      cta: 'What to do next',
    };
  }
  if (data?.severity === 'medium') {
    return {
      tone,
      icon: 'warning',
      headline: 'This crack should be repaired soon',
      detail: 'It is not an emergency, but water can get in and make it worse. Plan the repair within a few weeks.',
      cta: 'What to do next',
    };
  }
  return {
    tone,
    icon: 'ok',
    headline: 'This looks like a minor crack',
    detail: 'Usually just surface shrinkage. Keep an eye on it and take a photo every few months.',
    cta: 'What to do next',
  };
}

const WIDTH_PLAIN = {
  hairline: 'barely visible',
  fine: 'thin',
  moderate: 'noticeable',
  wide: 'wide',
  severe: 'very wide',
};

export const plainWidth = (widthClass) => WIDTH_PLAIN[widthClass] || 'unclear';

const CRACK_PLAIN = {
  hairline: 'Surface hairline cracks',
  shrinkage: 'Shrinkage cracking',
  flexural: 'Bending-related crack',
  diagonal_shear: 'Slanted crack (possible structural stress)',
  settlement: 'Crack from the ground settling',
  map_cracking: 'Network of surface cracks',
  corrosion_induced: 'Crack from rusting steel inside',
  thermal: 'Crack from heat and cooling',
  none_observed: 'No crack found',
};

export const plainCrackType = (type) => CRACK_PLAIN[type] || 'Crack';

const SURFACE_PLAIN = {
  concrete_column: 'concrete column',
  concrete_beam: 'concrete beam',
  slab_soffit: 'ceiling slab',
  masonry_wall: 'brick wall',
  retaining_wall: 'retaining wall',
  plaster_render: 'plastered wall',
  pavement_hardstand: 'floor slab',
  unknown: 'surface',
};

export const plainSurface = (surface) => SURFACE_PLAIN[surface] || 'surface';

const PRIORITY_PLAIN = {
  immediate: { label: 'Do this now', tone: 'act' },
  short_term: { label: 'Within a few weeks', tone: 'watch' },
  monitor: { label: 'Keep an eye on it', tone: 'good' },
};

export const plainPriority = (priority) => PRIORITY_PLAIN[priority] || PRIORITY_PLAIN.monitor;

/* ----------------------------------------------------------------- weather ----- */

const PERMIT_PLAIN = {
  go: { tone: 'good', headline: 'Good day to work', detail: 'The weather is inside safe limits for normal site work.' },
  caution: {
    tone: 'watch',
    headline: 'Work carefully today',
    detail: 'Conditions are usable, but one or two things need extra care.',
  },
  hold: { tone: 'act', headline: 'Do not do this work today', detail: 'Weather conditions make this work unsafe or bad for quality.' },
};

export function weatherStatus(data) {
  const base = PERMIT_PLAIN[data?.permit_status] || PERMIT_PLAIN.go;
  const concrete = data?.activity === 'concrete_pour';
  if (data?.permit_status === 'hold') {
    return {
      ...base,
      tone: toneFor('act'),
      icon: 'stop',
      headline: concrete ? 'Do not pour concrete today' : 'Not a safe day for this work',
    };
  }
  return { ...base, tone: toneFor(base.tone), icon: data?.permit_status === 'go' ? 'ok' : 'warning' };
}

const ACTIVITY_PLAIN = {
  concrete_pour: 'concrete pouring',
  excavation: 'digging and earthwork',
  masonry: 'brickwork and plaster',
  steel_erection: 'steel work',
  waterproofing: 'waterproofing',
  painting: 'painting',
  roofing: 'roofing',
  general_site: 'general site work',
};

export const plainActivity = (activity) => ACTIVITY_PLAIN[activity] || 'site work';

/* ------------------------------------------------------------- presentation ---- */

const STANDARD_NAMES = [
  [/^IS\s*456/, 'the Indian concrete code (IS 456)'],
  [/^IS\s*2925/, 'the Indian helmet standard (IS 2925)'],
  [/^IS\s*2750/, 'the Indian scaffolding standard (IS 2750)'],
  [/^IS\s*3764/, 'the Indian excavation standard (IS 3764)'],
  [/^IS\s*1905/, 'the Indian masonry code (IS 1905)'],
  [/^IS\s*3067/, 'the Indian waterproofing code (IS 3067)'],
  [/^IS\s*516|^IS\s*456.*15/, 'the Indian concrete testing standard'],
  [/^OSHA/i, 'US site-safety rules (OSHA)'],
  [/^ACI\s*224/, 'the crack-width guidance (ACI 224)'],
  [/^ACI\s*305|^ACI\s*306/, 'the hot and cold weather concreting guidance (ACI 305/306)'],
  [/^ACI\s*503|^EN\s*1504/, 'the concrete repair standard (EN 1504)'],
  [/^ACI\s*440/, 'the structural strengthening standard (ACI 440)'],
  [/^NBC/, 'the National Building Code'],
  [/^RERA/i, 'the RERA property law'],
  [/^ISO\s*7243/i, 'heat-stress guidance (ISO 7243)'],
];

/**
 * Turn "IS 456:2000 Cl. 35.3.2 / ACI 224.1R" into "the Indian concrete code (IS 456)".
 * Falls back to the first clause reference if nothing is recognised, so the reader still
 * gets a citation — just a shorter one.
 */
export function friendlyStandard(reference) {
  if (!reference) return null;
  const text = String(reference).trim();
  for (const [pattern, name] of STANDARD_NAMES) {
    if (pattern.test(text)) return name;
  }
  return text.split('/')[0].trim();
}

/** A single sentence, trimmed to a comfortable reading length. */
export function firstSentence(text, maxLength = 190) {
  if (!text) return '';
  const match = String(text).match(/^.*?[.!?](\s|$)/);
  const sentence = (match ? match[0] : String(text)).trim();
  if (sentence.length <= maxLength) return sentence;
  const cut = sentence.slice(0, maxLength);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : maxLength)}…`;
}

/** Friendly 0-100 label for a score where higher is better. */
export function scoreLabel(score) {
  const value = clamp(score);
  if (value >= 90) return 'Very good';
  if (value >= 75) return 'Good';
  if (value >= 55) return 'Needs work';
  return 'Poor';
}

export function scoreTone(score) {
  const value = clamp(score);
  if (value >= 90) return 'good';
  if (value >= 70) return 'watch';
  return 'act';
}

/** "July 2027" style label used for long-range timelines. */
export function monthYear(dateish) {
  if (!dateish) return '—';
  const date = new Date(`${dateish}`.length <= 10 ? `${dateish}T00:00:00` : dateish);
  if (Number.isNaN(date.getTime())) return String(dateish);
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** Human duration: "about 12 months" rather than "283 working days". */
export function plainDuration(workingDays) {
  const days = Number(workingDays) || 0;
  const months = Math.round(days / 26);
  if (months < 1) return 'under a month';
  if (months < 12) return `about ${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearText = `${years} year${years === 1 ? '' : 's'}`;
  return rest ? `about ${yearText} and ${rest} month${rest === 1 ? '' : 's'}` : `about ${yearText}`;
}

const PHASE_PLAIN = {
  planning: 'Permissions and design',
  foundation: 'Groundwork and foundation',
  structure: 'Concrete frame',
  envelope: 'Walls, roof and waterproofing',
  finishing: 'Finishing and fittings',
  handover: 'Handover and checks',
  completed: 'Finished',
};

export const plainPhase = (phase) => PHASE_PLAIN[phase] || phase;

const PROPERTY_PLAIN = {
  apartment: 'apartment',
  villa: 'villa or row house',
  commercial_retail: 'shop or retail unit',
  office: 'office space',
  industrial_warehouse: 'warehouse or factory',
  residential_plot: 'plot of land',
};

export const plainProperty = (type) => PROPERTY_PLAIN[type] || 'property';

/* --------------------------------------------------------------- rewrite pass -- */

/**
 * A small, ordered phrase glossary applied to any prose the model generated.
 *
 * The backend writes for engineers: "issue compliant IS 2925 industrial helmets",
 * "Class-2/3 retro-reflective vests", "gate-level PPE check". Simple View rewrites those
 * into words a site owner uses, and strips inline clause references — the citation is
 * still available in Expert View, it just is not useful mid-sentence here.
 *
 * This is intentionally a blunt substitution pass, not a parser: it must never fail, and
 * the worst case is a sentence that reads the same as before.
 */
const GLOSSARY = [
  // standards and certification language
  [/\bIS\s*2925(?:\s*(?:industrial\s*)?helmets?)?/gi, 'certified safety helmets'],
  [/\bIS\s*456\b/gi, 'the concrete code'],
  [/\bIS\s*2750\b/gi, 'the scaffolding code'],
  [/\bIS\s*3764\b/gi, 'the excavation code'],
  [/\bACI\s*224\b/gi, 'the crack-width guidance'],
  [/\bACI\s*305\b/gi, 'the hot-weather concreting guidance'],
  [/\bACI\s*306\b/gi, 'the cold-weather concreting guidance'],
  [/\bOSHA(?:\s*1926)?\b/g, 'site safety regulations'],
  [/\bISO\s*7243\b/gi, 'heat-stress guidance'],
  [/\bNBC\s*2016\b/gi, 'the National Building Code'],
  [/\bRERA\b/g, 'the property law'],

  // PPE and equipment
  [/\bClass[- ]?[23](?:\s*\/\s*3)?\s*retro-?reflective\s+vests?\b/gi, 'bright reflective jackets'],
  [/\bgate-?level\s+(?:PPE\s+)?check\b/gi, 'safety gear check at the site gate'],
  [/\bgate-?level\s+(?:PPE\s+)?checks\b/gi, 'safety gear checks at the site gate'],
  [/\bretro-?reflective\b/gi, 'reflective'],
  [/\bhi-?vis\b/gi, 'high-visibility'],
  [/\bPPE\b/g, 'safety gear'],
  [
    /\bfall[- ]arrest (systems?|equipment|devices?)\b/gi,
    (match, kind) => (/s$/i.test(kind) ? 'safety harnesses' : 'safety harness'),
  ],
  [/\beye protection\b/gi, 'safety glasses'],
  [/\bhearing protection\b/gi, 'ear protection'],
  [/\brespiratory protection\b/gi, 'dust masks'],

  // site process language
  [/\btoolbox talks?\b/gi, 'short safety briefing'],
  [/\bmethod statements?\b/gi, 'written work plan'],
  [/\bedge protection\b/gi, 'guard rails'],
  [/\bexclusion zones?\b/gi, 'keep-clear areas'],
  [/\btemporary works\b/gi, 'temporary structures'],
  [/\bcompetent person\b/gi, 'qualified supervisor'],
  [/\bhousekeeping\b/gi, 'keeping the area tidy'],
  [/\bgate-?level\b/gi, 'site gate'],
  [/\b(?:the\s+)?worker'?s?\s+(?:induction\s+)?records?\b/gi, "the worker's training record"],
  [/\binduction\b/gi, 'site training'],
  [/\baffected bay\b/gi, 'affected area'],
  [/\bplant-?operating zones?\b/gi, 'areas where machines are working'],
  [/\bnon-?complian(?:t|ce)\b/gi, 'not following the rules'],
  [/\bpermit[- ]to[- ]work\b/gi, 'written permission'],
  [/\bde-?shuttering\b/gi, 'removing formwork'],
  [/\bshuttering\b/gi, 'formwork'],
  [/\bsoffit\b/gi, 'underside'],

  // weather advisory phrasing
  [/\bconcrete placement cleared\b/gi, 'Concrete pouring can go ahead'],
  [/\bconditions within specification\b/gi, 'conditions are within safe limits'],
  [/\belevated heat load\b/gi, 'high heat'],
  [/\bhydration and shade controls\b/gi, 'water and shade breaks'],
  [/\bwithin specification\b/gi, 'within safe limits'],

  // concreting / specification wording
  [/\bthe concrete code hot-weather envelope\b/gi, 'the safe hot-weather limits'],
  [/\bthe concrete code cold-weather envelope\b/gi, 'the safe cold-weather limits'],
  [/\bhot-weather envelope\b/gi, 'safe hot-weather limits'],
  [/\bspecification envelope\b/gi, 'safe limits'],
  [/\bworkability envelope\b/gi, 'safe working limits'],

  // structural repair vocabulary
  [/rebound[- ]hammer\s*\/?\s*UPV(?: testing)?/gi, 'a quick strength test'],
  [/\bUPV\b/gi, 'strength testing'],
  [/\bdemountable mechanical(?:\s*\(DEMEC\))?\s*(?:gauge\s*)?studs\b/gi, 'small crack gauges'],
  [/\bDEMEC\b/gi, 'crack gauge'],
  [/epoxy injection\s*\/\s*jacketing/gi, 'sealing the crack and strengthening the member'],
  [/\bjacketing\b/gi, 'strengthening wrap'],
  [/\bpropping or shoring\b/gi, 'supports'],
  [/\bprop\/shore\b/gi, 'support'],
  [/\bshore\b/gi, 'support'],
  [/\bthe affected member\b/gi, 'the affected beam or column'],
  [/\bnon-?destructive testing\b/gi, 'checks that do not damage the concrete'],

  // materials and defects
  [/\bspalling\b/gi, 'chipped concrete'],
  [/\befflorescence\b/gi, 'white salt staining'],
  [/\bcarbonation\b/gi, 'concrete ageing'],
  [/\bdelamination\b/gi, 'separating layers'],
  [/\befflorescence\b/gi, 'salt staining'],
];

// Any parenthetical that contains a standard token, e.g. "(OSHA 1926.501)":
// matches first so the citation never survives as a mangled half-sentence.
const CITATION_PAREN = /[,\s]*\((?=[^)]*\b(?:IS|ACI|OSHA|NBC|RERA|ISO|EN)\b)[^)]*\)/g;
// "as per IS 456 Cl. 15" / "in accordance with ACI 224.1R" mid-sentence.
const INLINE_REF = /\s*(?:as\s+)?(?:per|in\s+accordance\s+with|under)\s+(?:IS|ACI|OSHA|NBC|ISO|EN)\s*\d+[^,;]*/gi;
// Trailing clause fragments such as "Cl. 15" or "Clause 6.2.1" left behind above.
const CLAUSE_REF = /[,\s]*\b(?:Cl\.|Clause)\s*\d+[\d.()a-z-]*/gi;

export function plainRewrite(text) {
  if (!text) return '';
  let out = String(text);
  // Strip citations *before* the glossary, otherwise "IS 456" becomes
  // "the concrete code" and the citation pattern no longer recognises it.
  out = out.replace(CITATION_PAREN, '');
  out = out.replace(INLINE_REF, '');
  out = out.replace(CLAUSE_REF, '');
  for (const [pattern, replacement] of GLOSSARY) out = out.replace(pattern, replacement);
  // Tidy the artefacts the substitutions leave behind.
  out = out
    .replace(/\bcompliant\s+(certified|bright|safety)/gi, '$1')
    .replace(/\ba\s+at\s+the\s+site\s+gate/gi, 'a site-gate')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\.{2,}/g, '.')
    .replace(/,\s*,/g, ',')
    .trim();
  // Collapse accidental word doubling produced by overlapping rules
  // ("temporary temporary supports", "site gate gate check").
  out = out.replace(/\b(\w+)\s+\1\b/gi, '$1');
  out = out.charAt(0).toUpperCase() + out.slice(1);
  // Stripping a trailing citation can remove the sentence's full stop; put it back.
  if (/[.!?]$/.test(String(text).trim()) && !/[.!?]$/.test(out)) out += '.';
  return out;
}

/** Rewrite, then trim to a single comfortable sentence. */
export function plainSentence(text, maxLength = 190) {
  return firstSentence(plainRewrite(text), maxLength);
}

/* ------------------------------------------------------------------ chat copy -- */

/**
 * Clean up a RAG answer for Simple View.
 *
 * The backend composes answers for engineers: a retrieval preamble, per-extract headings
 * ending in clause references, `[KB-xxx]` markers, and a traceability footer. In Simple
 * View the question is already on screen, so the preamble and footer are noise, and the
 * clause references belong in Expert View.
 */
export function simpleChatAnswer(text) {
  if (!text) return '';

  const paragraphs = String(text).split(/\n{2,}/);

  const visible = paragraphs.filter((block) => {
    const head = block.trim();
    if (/^Here is what the platform'?s standards corpus says/i.test(head)) return false;
    if (/^This answer is assembled directly from the corpus extracts/i.test(head)) return false;
    return head.length > 0;
  });

  const cleaned = visible.map((block) =>
    block
      // "**Curing of concrete — methods** — IS 456:2000 Cl. 13.5 (Curing)" → keep the title
      .replace(/^(\*\*[^*]+\*\*)\s*[—–-]\s*(?:IS|ACI|OSHA|NBC|RERA|ISO|EN)\b.*$/gm, '$1')
      // Stray document ids and empty citation brackets
      .replace(/\s*\[KB-\d+\]/g, '')
      .replace(/\s*\(\s*\)/g, '')
      .trim(),
  );

  return cleaned.join('\n');
}
