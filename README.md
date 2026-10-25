# Multimodal Construction Intelligence Platform

A decision-support console for construction professionals. It fuses **vision analysis**
(site safety, structural cracking), **quantitative modelling** (valuation, CPM scheduling) and
**retrieval-augmented knowledge** (IS / ACI / OSHA / NBC / RERA standards) behind a single,
strictly-typed API and a professional industrial dashboard.

---

## Why this architecture

| Concern | Decision | Rationale |
|---|---|---|
| **Never dead-end** | Every AI module has a deterministic fallback | The app is fully functional with **zero API keys**. Vision falls back to a calibrated CV pipeline; the assistant falls back to extractive RAG. |
| **Honest output** | `EngineMeta` on every AI response | The UI can always say *which* engine produced an answer, its model, latency and confidence. A heuristic screening can never be mistaken for a model inference. |
| **No contract drift** | Pydantic v2 with `extra="forbid"` + `model_validator` invariants | Unknown fields are rejected; cross-field invariants (e.g. *critical hazard ⇒ overall risk critical*) are enforced server-side. |
| **Reproducible numbers** | Valuation and planning are **not** LLM-generated | The LLM writes prose, never arithmetic. Every valuation driver is itemised so the total can be recomputed by hand. |
| **Grounded answers** | Retrieval gates the generator | The assistant retrieves first; out-of-domain questions return an explicit *no-match* rather than a plausible guess. |

---

## Quick start

```bash
# 1 — Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env          # optional: add an LLM key here
uvicorn main:app --reload --port 8000

# 2 — Frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173

# or, with make
make install && make dev
```

| URL | What |
|---|---|
| `http://localhost:5173` | The dashboard (Vite dev server, proxies `/api` → `:8000`) |
| `http://localhost:8000/docs` | Interactive OpenAPI docs |
| `http://localhost:8000/health` | Liveness + engine capability probe |
| `http://localhost:8000/api/contracts` | Machine-readable JSON Schema for every contract |

**Production build (single origin):**

```bash
docker compose up --build
```

The Docker image builds the frontend and serves it alongside the API from one FastAPI process.
It runs as a non-root user. Open `http://localhost:8000` to use the app.

### Configure Gemini securely

The backend reads `GEMINI_API_KEY` from its environment; the key is never needed in frontend
code. For local Docker use, copy `backend/.env.example` to an untracked `.env` in the project
root, set `GEMINI_API_KEY` in that file, and start the stack with `docker compose up --build`.
For a hosting provider, add `GEMINI_API_KEY` using its encrypted environment-variable or secret
manager UI. Do not commit keys, put them in `VITE_*` variables, or paste them into source files.

Set `AI_PROVIDER=gemini` to require Gemini, or leave it as `auto` to select the first configured
provider and fall back to the built-in heuristic engine. Revoke any key that has been shared in
chat, screenshots, source control, or logs; create a replacement and restrict it to the required
Generative Language API and suitable usage quotas in Google AI Studio / Google Cloud.

### Before public deployment

Use the Dockerfile as the deployment artifact and configure the host with:

* `ENVIRONMENT=production` and `DEBUG=false`.
* `GEMINI_API_KEY` as a host-managed secret and `AI_PROVIDER=gemini` (or `auto`).
* `CORS_ORIGINS` set to the exact trusted frontend origins. For the bundled, same-origin UI,
  this can be empty; do not allow arbitrary origins when serving a separate frontend.
* An HTTPS-enabled host, a billing/usage limit for the Gemini project, and monitoring for
  `/health` and provider failures.
* An authenticated gateway and request limits before exposing paid analysis endpoints to
  untrusted users. This application does not currently provide user authentication or
  distributed rate limiting.

The sample `.env` files are for local development only. The repository does not contain
production credentials.

---

## Two ways to read the same system

The console is used by two very different people: a site owner who wants to know *whether it is
safe to pour concrete today*, and an engineer who wants the width classification, the confidence
score and the clause reference. Rather than compromise, the UI ships **two modes over one identical
backend contract**. The toggle sits in the top bar and the choice persists in
`localStorage['cip.viewMode']` (default: Simple).

| | **Simple View** | **Expert Mode** |
|---|---|---|
| Audience | Site owner, contractor, client | Engineer, safety officer, valuer |
| Navigation | Tasks — "Check site safety", "What is it worth?" | Modules — "Safety Monitor", "Valuation & Planning" |
| Output | One colour-coded verdict card + numbered actions | Full metric panels, hazard register, raw cites |
| Vision modules | 3-step wizard: **Photo → Quick check → Advice** | Upload + parameter form, results pane with overlays |
| Commercial | Headline price / handover date; workings behind *View detailed breakdown* | Itemised value drivers, CPM timeline, resource roll-up |
| Weather | "Good day to work" + what to do about it | Permit status, work windows, 7-day workability table |
| Assistant | Chat bubbles, follow-up chips, sources collapsed | Citation cards, relevance scores, corpus browser |
| Hides | Codes (`KB-004`), clause numbers, px metrics, matrices | — |
| Still available | Everything, one mode-switch away | — |

Three things make Simple View a real mode rather than a CSS filter:

1. **A translation layer** (`src/lib/plainEnglish.js`) maps enums to sentences —
   `high → "This area needs attention"`, `diagonal_shear → "Slanted crack (possible structural
   stress)"`, `hold → "Do not pour concrete today"` — and rewrites model prose with a site
   vocabulary glossary (*toolbox talk* → *short safety briefing*, *IS 2925 helmets* → *certified
   safety helmets*, *edge protection* → *guard rails*), stripping inline clause references as it
   goes.
2. **A different information architecture.** The photo modules become a three-step wizard with a
   progress checklist that names what the engine is doing; the commercial module asks four questions
   before it shows a number.
3. **One rule per screen: the verdict first.** `StatusCard` renders green/amber/red with a single
   headline, at most one sentence of explanation and one primary action. Supporting metrics are
   demoted to three glance tiles; everything else is folded into a disclosure.

Mode is provided by `ViewModeProvider` (`src/lib/viewMode.jsx`) and read with `useViewMode()` —
`{ mode, isSimple, isExpert, setMode }`. Switching is instant: no reload, no refetch, and any result
already on screen stays on screen.

```
frontend/src/
├── lib/viewMode.jsx            context + persistence + data-view-mode attribute
├── lib/plainEnglish.js         enum → sentence, jargon glossary, chat sanitiser
└── components/ui/
    ├── ViewModeToggle.jsx      segmented switch, ExpertOnly / SimpleOnly helpers
    ├── Wizard.jsx              Stepper, StepPanel, CheckingPanel
    ├── StatusCard.jsx          the verdict card + FactGrid glance tiles
    └── Disclosure.jsx          "View detailed breakdown" accordion
```

Both modes were screenshot-verified at 1440 px and 390 px; `body.scrollWidth` equals the viewport
width in every module, i.e. no horizontal overflow on mobile.


---

## Configuration

Everything has a safe default; the app runs with no `.env` at all.

| Variable | Default | Effect |
|---|---|---|
| `AI_PROVIDER` | `auto` | `auto` picks the first configured provider, else `heuristic` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | — | Enables the multimodal LLM path |
| `MAX_UPLOAD_MB` | `12` | Upload ceiling (enforced before decode) |
| `WEATHER_PROVIDER` | `open-meteo` | Set to `simulated` to force deterministic synthetic weather |
| `CORS_ORIGINS` | localhost:5173/4173 | Add your deployed frontend origin |
| `SERVE_FRONTEND` | `true` | Serve `frontend/dist` from FastAPI |

**Engine behaviour matrix**

| Keys configured | Safety & Crack | Assistant | Badge in UI |
|---|---|---|---|
| none | Calibrated CV heuristics | Extractive RAG (BM25) | `Heuristic engine` |
| any one provider | Multimodal LLM (JSON mode) | LLM grounded on retrieved context | `LLM · <provider>` |
| provider fails / times out | Automatic fallback, never a 500 | Automatic fallback | `Heuristic engine` |

---

## Modules

### 1 · Site Safety Monitoring — `POST /api/analysis/safety`
Upload a site photograph (+ optional context, strictness).

* **LLM path** — the frame goes to a vision model which returns a hazard JSON; the server then
  **re-derives every invariant**: compliance index, overall risk, PPE counts and stop-work flag,
  so a hallucinated total cannot reach the UI.
* **Heuristic path** — worker density from hi-vis/skin pixel ratios, PPE non-compliance from the
  exposed-skin-to-hi-vis ratio, plus fall/edge, housekeeping, lighting and plant hazards inferred
  from ridge linearity, clutter density, luminance and industrial-blue mass.
* Returns severity-ranked hazards with **normalised bounding boxes** (overlaid on the image in the UI),
  per-PPE compliance bars, a corrective action plan and standards citations.

### 2 · Crack Detection & Structural Analysis — `POST /api/analysis/crack`

* **Heuristic path** — a **morphological black-hat** transform isolates thin dark line-like
  features (cracks, joints), far more discriminative than raw edge magnitude. Three statistics drive
  the diagnosis: **density** (how much of the frame is cracked), **coherence** (magnitude-weighted
  orientation concentration — is it a line or a chaotic network?) and **spread** (fraction of a 4×4
  grid carrying activity — one crack vs. all-over map cracking).
* Width is mapped to **ACI 224 / IS 456** banding; severity is a pure function of width + pattern,
  re-derived server-side even on the LLM path so model and rule can never disagree.
* Outputs remediation method statements (prop → monitor → epoxy injection → jacketing/CFRP) with
  EN 1504 / ACI 503R / ACI 440.2R references.

### 3 · Valuation & Project Planning

**`POST /api/valuation`** — hedonic replacement-cost model:
`city base rate × (1 + Σ driver deltas) × super built-up area`.
Drivers cover asset class, age depreciation (capped), finish, structure, floor position, parking,
recognised amenities (capped at 18% so lists can't be gamed) and delivery status. Every driver is
returned with its signed % and currency impact, so **the answer is reproducible from the response
alone**. Confidence widens the price band when inputs are sparse or the city has no index.

**`POST /api/plan`** — CPM-style programme generator. Durations are quantity-driven, not
area-linear: the superstructure is paced by the **floor cycle**, finishes by **unit count**, and the
envelope by **façade height** — which keeps a 2,400 sqft house and a 1,20,000 sqft tower both in
realistic ranges. A working calendar excludes Sundays; contingency is 8% (12% with site
constraints); the target duration is graded `on_track → tight → aggressive → unrealistic`.

### 4 · Weather-Aware Advisory & RAG Assistant

**`GET /api/weather/advisory`** — live **Open-Meteo** (no key) with a city-seeded **simulator**
fallback. Encodes real constraints:

| Condition | Rule applied |
|---|---|
| Rain ≥ 8 mm or ≥ 75% probability | **Hold** — water-cement ratio damage, laitance |
| Ambient ≥ 40 °C | **Hold** — IS 456 / ACI 305R placement limit (35 °C concrete) |
| Ambient 35–40 °C | Caution — pre-cool aggregates, retarder, immediate curing |
| Ambient ≤ 5 °C | **Hold** — ACI 306R cold-weather protection |
| Gusts ≥ 60 km/h | **Hold** — suspend lifting and work at height |
| Thunderstorm forecast | Lightning stand-down (30-minute rule) |
| WBGT banding | Heat-stress category with work-rest cycle and hydration controls |

**`POST /api/assistant/chat`** — RAG over a curated 30-document corpus (IS 456, ACI 224/305/306/503/
440, OSHA 1926, IS 2925/2750/3764, NBC 2016, RERA). Retrieval is a hybrid **BM25 + curated-metadata
gate**: a document must share *discriminative* vocabulary with its title/tags/section (not just body
text) to qualify, which is what lets off-domain questions return an honest *no-match* instead of a
coincidental citation.

---

## Project structure

```
construction-intelligence-platform/
├── backend/
│   ├── main.py                  # FastAPI app, CORS, error handlers, SPA mount
│   ├── config.py                # Typed settings (pydantic-settings)
│   ├── models/
│   │   └── schemas.py           # ALL Pydantic contracts + enum registry
│   ├── routers/
│   │   ├── _common.py           # request IDs, upload guards
│   │   ├── analysis.py          # /api/analysis/safety, /crack
│   │   ├── valuation.py         # /api/valuation, /api/plan
│   │   └── advisory.py          # /api/weather/advisory, /api/assistant/*
│   ├── services/
│   │   ├── llm.py               # OpenAI / Anthropic / Gemini adapters
│   │   ├── image_ops.py         # decode, Sobel, morphology, features
│   │   ├── safety.py            # Module 1
│   │   ├── crack.py             # Module 2
│   │   ├── valuation.py         # Module 3a
│   │   ├── planner.py           # Module 3b
│   │   ├── weather.py           # Module 4a
│   │   ├── knowledge.py         # Module 4b (RAG)
│   │   └── common.py            # severity maths, EngineMeta factory
│   ├── data/knowledge_base.json # 30-document standards corpus
│   ├── static/samples/          # curated demo images
│   ├── tests/test_api.py        # 84 contract / invariant / retrieval tests
│   ├── requirements.txt | requirements-dev.txt | .env.example
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Navbar.jsx  Sidebar.jsx  Overview.jsx
    │   │   ├── SafetyMonitor.jsx  CrackAnalyzer.jsx
    │   │   ├── ValuationPlanner.jsx  WeatherAdvisory.jsx
    │   │   ├── AssistantChat.jsx  ErrorBoundary.jsx
    │   │   └── ui/  Primitives.jsx, ImageDropzone.jsx
    │   ├── hooks/useAsync.js     # async state, backend health, samples
    │   ├── lib/api.js            # axios client + uniform ApiError
    │   ├── lib/format.js         # severity theming, INR, dates
    │   ├── App.jsx  main.jsx  index.css
    └── package.json | vite.config.js | tailwind.config.js
```

---

## API contract example

```bash
curl -X POST http://localhost:8000/api/analysis/safety \
  -F "image=@backend/static/samples/site-01.jpg" \
  -F "site_context=Level 4 — north edge" \
  -F "strictness=strict"
```

```jsonc
{
  "analysis_id": "a49b2a97…",
  "overall_risk": "high",
  "compliance_score": 75,
  "workers_detected": 4,
  "ppe_compliance": [
    { "kind": "helmet", "workers_checked": 4, "compliant": 2, "violations": 2 }
  ],
  "hazards": [{
    "id": "HZ-01",
    "category": "missing_ppe",
    "severity": "high",
    "title": "2 worker(s) without head protection",
    "zone": "Level 8 — North structural bay",
    "bbox": { "x": 0.29, "y": 0.12, "w": 0.22, "h": 0.25 },
    "recommendation": "Stop work in the affected bay, issue compliant IS 2925 helmets…",
    "standard_reference": "OSHA 1926.95-1926.107 / IS 2925:1984"
  }],
  "stop_work_recommended": false,
  "engine": {
    "engine_mode": "heuristic",
    "provider": "heuristic",
    "model": "cv-heuristics-v1",
    "confidence": 0.61,
    "disclosure": "Produced by the offline deterministic vision engine…"
  }
}
```

### Error envelope

Every failure — validation, upload, provider, unhandled — returns the same shape:

```json
{
  "error": { "code": "file_too_large", "message": "Image is 13.0 MB but the limit is 12 MB…",
             "field": "image", "request_id": "cead…" },
  "status": 413
}
```

| Status | `code` | When |
|---|---|---|
| 413 | `file_too_large` | Upload exceeds `MAX_UPLOAD_MB` |
| 415 | `unsupported_media_type` / `not_an_image` | Declared MIME rejected / content sniff failed |
| 422 | `validation_error` | Pydantic contract violation (message lists each field) |
| 422 | `invalid_surface_type` | Bad enum in a form field |
| 422 | `image_too_small` | Short edge < 32 px |
| 503 | `analysis_engine_unavailable` | Vision provider down and no fallback succeeded |
| 500 | `internal_error` | Logged with the request id |

Every response carries `X-Request-ID` and `X-Process-Time-Ms`.

---

## Testing

```bash
cd backend && python -m pytest tests -q      # 84 passed
cd backend && ruff check . --select F,E9     # clean
```

The suite asserts **behaviour, not snapshots**:

* every response validates against its Pydantic contract, on both the LLM and fallback paths;
* severity ordering, bbox bounds, PPE arithmetic, permit-status derivation;
* **valuation arithmetic is reproducible** — driver percentages multiplied out must reproduce the
  quoted per-sqft rate;
* **planning sequencing is monotonic** — no milestone starts before its predecessor ends, phase
  weights sum to 100, tasks fit their phase window;
* **RAG precision and refusal** — 9 known answers must rank first, 4 off-domain questions must
  return zero hits.

---

## Design notes worth knowing

1. **The morphology order matters.** Greyscale *closing* is `erode(dilate(x))`, not
   `dilate(erode(x))`. Inverting them makes the black-hat uniformly negative and silently destroys
   the crack signal while every downstream number still looks plausible. This is commented in
   `image_ops._closing` so it does not regress.

2. **Percentile thresholds are not features.** The first version of the edge detector thresholded
   Sobel magnitude at the 97th percentile, which by construction marks exactly 3% of pixels in every
   image — a constant masquerading as a measurement. It now uses an absolute threshold.

3. **Orientation must be rotated by 90°.** The Sobel gradient points *across* a ridge; a surveyor
   measures *along* the crack. The reported angle is the ridge orientation.

4. **Coherence alone cannot separate a crack from map cracking.** A single clean crack in aggregate
   texture and a craze network both score low on unweighted orientation concentration. The
   discriminator that works is **spread**: a directed crack lights up a narrow band of a 4×4 grid,
   whereas map cracking covers the whole surface. Coherence is additionally weighted by black-hat
   intensity so the deep crack dominates faint speckle.

5. **LLM output is re-derived, not trusted.** On the LLM path the model's `overall_risk`,
   compliance score and severity grade are recomputed from its own hazard list and the width rules.
   The model contributes *perception* (what it sees, where); the server owns *logic*.

---

## Limitations (read before relying on it)

* **Not a certified inspection, valuation, or structural assessment.** Single-image analysis cannot
  establish scale, depth or context. Crack widths are *estimates from ridge geometry*, labelled as
  such in the UI; the width band is only as good as the assumed frame span.
* The heuristic vision path is a **screening triage** tuned for medium/wide shots of people and
  close-ups of surfaces. It does not run a trained object detector; count and PPE rates are density
  proxies and are disclosed as `engine_mode: heuristic` with a 0.48–0.68 confidence.
* Property rates are **indicative index values** for Indian cities, not transaction data. They are
  useful for relative comparison and order-of-magnitude checks, not for lending decisions.
* Planning durations come from an industry-standard template scaled by quantity; they must be
  re-validated against the selected contractor's productivity norms.
* Weather advice is rule-based over Open-Meteo data; site-specific microclimate, lightning detection
  and local authority restrictions override it.
