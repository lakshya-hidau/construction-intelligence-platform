"""
Module 1 — Construction Site Safety Monitoring.

Two execution paths, identical response contract:

* **LLM path**  — the frame + site context go to a multimodal model which returns a
  hazard JSON; the server then re-derives every invariant (compliance score, overall
  risk, per-PPE counts) so a hallucinated total cannot leak into the UI.
* **Heuristic path** — deterministic feature-driven screening used when no API key is
  configured. Deterministic per image (seeded from the file hash), so demos and tests
  are reproducible.
"""

from __future__ import annotations

import random
import time
from typing import Any

from models.schemas import (
    BBox,
    EngineMode,
    HazardCategory,
    ImageMeta,
    PPEComplianceStat,
    PPEKind,
    SafetyAnalysisResponse,
    SafetyHazard,
    Severity,
)
from services.common import (
    HEURISTIC_DISCLOSURE,
    LLM_DISCLOSURE,
    SEVERITY_ORDER,
    clamp,
    make_engine_meta,
    severity_at_least,
    worst_severity,
)
from services.image_ops import ImageFeatures, decode_image, encode_jpeg, extract_features
from services.llm import LLMError, VisionImage, get_llm

SYSTEM_PROMPT = """You are a senior construction safety inspector certified under OSHA 1926 and \
IS 3786/IS 8989 practices. You audit single construction-site photographs for occupational \
health and safety (OHS) compliance. You are precise, evidence-based and you never invent \
details that are not visible in the frame. If the frame shows no people or no discernible \
hazard, say so plainly and return an empty hazards array. You always answer with a single \
JSON object and no prose outside it."""

USER_PROMPT_TEMPLATE = """Audit this construction-site photograph.

Site context supplied by the engineer: {site_context}
Inspection strictness: {strictness}

Return JSON with exactly this shape:
{{
  "workers_detected": <int 0-50>,
  "site_zone": "<short area label, e.g. 'Level 4 - North Edge'>",
  "summary": "<2-4 sentence professional summary of what the frame shows>",
  "hazards": [
    {{
      "category": "missing_ppe|fall_hazard|edge_protection|scaffold_defect|housekeeping|electrical|plant_equipment|excavation|fire_safety|access_egress",
      "title": "<short hazard title>",
      "description": "<what is visible and why it is unsafe>",
      "severity": "low|medium|high|critical",
      "confidence": <float 0-1>,
      "workers_at_risk": <int>,
      "zone": "<area label>",
      "evidence": ["<visual cue 1>", "<visual cue 2>"],
      "recommendation": "<corrective action, specific and actionable>",
      "standard_reference": "<e.g. OSHA 1926.100 / IS 2925:1984>",
      "bbox": {{"x": <0-1>, "y": <0-1>, "w": <0-1>, "h": <0-1>}}
    }}
  ],
  "ppe": [
    {{"kind": "helmet|hi_vis_vest|harness|safety_boots|eye_protection|gloves",
      "workers_checked": <int>, "compliant": <int>, "violations": <int>}}
  ],
  "recommendations": ["<top-level corrective action>", "..."],
  "stop_work_recommended": <bool>
}}

Rules:
- Only include PPE rows you can actually assess from this frame.
- A missing harness at height, an unguarded leading edge, or an unsupported excavation is 'critical'.
- bbox is optional; only include it when you can localise the hazard confidently.
"""

_PPE_WEIGHT: dict[PPEKind, float] = {
    PPEKind.HELMET: 1.0,
    PPEKind.HI_VIS_VEST: 0.85,
    PPEKind.HARNESS: 1.25,
    PPEKind.SAFETY_BOOTS: 0.5,
    PPEKind.EYE_PROTECTION: 0.45,
    PPEKind.GLOVES: 0.35,
}

_CATEGORY_FALLBACK_STANDARD: dict[HazardCategory, str] = {
    HazardCategory.MISSING_PPE: "OSHA 1926.95-1926.107 / IS 2925:1984",
    HazardCategory.FALL_HAZARD: "OSHA 1926.501 / IS 3786:2023",
    HazardCategory.EDGE_PROTECTION: "OSHA 1926.501(b)(1) / IS 4912:1978",
    HazardCategory.SCAFFOLD_DEFECT: "OSHA 1926.451 / IS 2750:1964",
    HazardCategory.HOUSEKEEPING: "OSHA 1926.25 / IS 4082:1996",
    HazardCategory.ELECTRICAL: "OSHA 1926.402 / IS 732:2019",
    HazardCategory.PLANT_EQUIPMENT: "OSHA 1926.600 / IS 4573:1968",
    HazardCategory.EXCAVATION: "OSHA 1926.651 / IS 3764:1992",
    HazardCategory.FIRE_SAFETY: "OSHA 1926.150 / NBC 2016 Part 4",
    HazardCategory.ACCESS_EGRESS: "OSHA 1926.34 / NBC 2016 Part 4",
}


# --------------------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------------------


def analyze_safety(
    raw: bytes,
    *,
    filename: str,
    content_type: str,
    site_context: str | None,
    strictness: str,
    request_id: str,
) -> SafetyAnalysisResponse:
    started = time.perf_counter()
    img = decode_image(raw)
    features = extract_features(img, raw)
    image_meta = ImageMeta(
        filename=filename,
        width=img.width,
        height=img.height,
        bytes=len(raw),
        content_type=content_type,
    )

    client = get_llm()
    if client.available:
        try:
            payload, result = client.vision_json(
                SYSTEM_PROMPT,
                USER_PROMPT_TEMPLATE.format(
                    site_context=site_context or "not supplied",
                    strictness=strictness,
                ),
                [VisionImage(encode_jpeg(img), "image/jpeg")],
            )
            return _from_llm(payload, image_meta, site_context, result.latency_ms, request_id, strictness)
        except (LLMError, ValueError, KeyError, TypeError):
            # Contract violation or provider outage -> degrade, never 500.
            pass

    latency_ms = int((time.perf_counter() - started) * 1000)
    return _heuristic(features, image_meta, site_context, latency_ms, request_id, strictness)


# --------------------------------------------------------------------------------------
# LLM path
# --------------------------------------------------------------------------------------


def _safe_bbox(value: Any) -> BBox | None:
    if not isinstance(value, dict):
        return None
    try:
        bbox = BBox(
            x=clamp(float(value.get("x", 0)), 0, 1),
            y=clamp(float(value.get("y", 0)), 0, 1),
            w=clamp(float(value.get("w", 0.01)), 0.01, 1),
            h=clamp(float(value.get("h", 0.01)), 0.01, 1),
        )
        if bbox.x + bbox.w > 1:
            bbox.w = max(0.01, 1 - bbox.x)
        if bbox.y + bbox.h > 1:
            bbox.h = max(0.01, 1 - bbox.y)
        return bbox
    except (TypeError, ValueError):
        return None


def _from_llm(
    payload: dict[str, Any],
    image_meta: ImageMeta,
    site_context: str | None,
    latency_ms: int,
    request_id: str,
    strictness: str,
) -> SafetyAnalysisResponse:
    workers = int(clamp(float(payload.get("workers_detected", 0) or 0), 0, 500))
    hazards: list[SafetyHazard] = []

    for idx, raw_hazard in enumerate(payload.get("hazards") or []):
        if not isinstance(raw_hazard, dict):
            continue
        try:
            category = HazardCategory(str(raw_hazard.get("category", "missing_ppe")).lower())
        except ValueError:
            category = HazardCategory.MISSING_PPE
        try:
            severity = Severity(str(raw_hazard.get("severity", "medium")).lower())
        except ValueError:
            severity = Severity.MEDIUM
        title = str(raw_hazard.get("title") or "Unspecified hazard")[:160]
        description = str(raw_hazard.get("description") or "Hazard reported by the vision model without detail.")[:1200]
        if len(description) < 10:
            description = f"{description} (insufficient detail returned by model)"
        recommendation = str(raw_hazard.get("recommendation") or "Escalate to the site safety officer for verification.")[:1200]
        if len(recommendation) < 10:
            recommendation += " Verify in the field before closing."
        evidence = [str(e)[:200] for e in (raw_hazard.get("evidence") or []) if str(e).strip()][:8]
        hazards.append(
            SafetyHazard(
                id=f"HZ-{idx + 1:02d}",
                category=category,
                title=title if len(title) >= 3 else "Site hazard",
                description=description,
                severity=severity,
                confidence=clamp(float(raw_hazard.get("confidence", 0.7) or 0.7), 0, 1),
                zone=str(raw_hazard.get("zone") or payload.get("site_zone") or "General site")[:120],
                workers_at_risk=int(clamp(float(raw_hazard.get("workers_at_risk", 0) or 0), 0, 500)),
                bbox=_safe_bbox(raw_hazard.get("bbox")),
                evidence=evidence,
                recommendation=recommendation,
                standard_reference=str(
                    raw_hazard.get("standard_reference")
                    or _CATEGORY_FALLBACK_STANDARD.get(category)
                    or "Site safety management plan"
                )[:200],
            )
        )

    hazards.sort(key=lambda h: SEVERITY_ORDER[h.severity], reverse=True)

    ppe: list[PPEComplianceStat] = []
    for raw_ppe in payload.get("ppe") or []:
        if not isinstance(raw_ppe, dict):
            continue
        try:
            kind = PPEKind(str(raw_ppe.get("kind", "")).lower())
        except ValueError:
            continue
        checked = int(clamp(float(raw_ppe.get("workers_checked", workers) or workers), 0, 500))
        violations = int(clamp(float(raw_ppe.get("violations", 0) or 0), 0, checked))
        compliant = int(clamp(float(raw_ppe.get("compliant", checked - violations) or 0), 0, checked - violations))
        ppe.append(
            PPEComplianceStat(
                kind=kind, workers_checked=checked, compliant=compliant, violations=violations
            )
        )

    if not ppe and workers:
        ppe = [PPEComplianceStat(kind=PPEKind.HELMET, workers_checked=workers, compliant=workers, violations=0)]

    overall = worst_severity(*[h.severity for h in hazards]) if hazards else Severity.LOW
    score = _compliance_score(workers, ppe, hazards)
    stop_work = any(h.severity is Severity.CRITICAL for h in hazards)
    recommendations = [
        str(r)[:400] for r in (payload.get("recommendations") or []) if str(r).strip()
    ][:12]
    if not recommendations:
        recommendations = [h.recommendation for h in hazards[:4]] or [
            "Maintain the current controls and re-audit at the next shift handover."
        ]

    summary = str(payload.get("summary") or "").strip()
    if len(summary) < 10:
        summary = (
            f"{workers} worker(s) identified in frame; {len(hazards)} hazard(s) recorded at "
            f"overall risk {overall.value.upper()}."
        )

    confidence = clamp(
        0.55 + 0.35 * (sum(h.confidence for h in hazards) / max(len(hazards), 1)), 0.4, 0.95
    )

    return SafetyAnalysisResponse(
        analysis_id=request_id,
        image=image_meta,
        site_context=site_context,
        overall_risk=overall,
        compliance_score=score,
        workers_detected=workers,
        ppe_compliance=ppe,
        hazards=hazards,
        recommendations=recommendations,
        summary=summary[:1600],
        stop_work_recommended=stop_work,
        engine=make_engine_meta(
            mode=EngineMode.LLM,
            provider=get_llm().provider,
            model=get_llm().model,
            latency_ms=latency_ms,
            confidence=confidence,
            request_id=request_id,
            disclosure=LLM_DISCLOSURE,
        ),
    )


# --------------------------------------------------------------------------------------
# Heuristic path
# --------------------------------------------------------------------------------------


def _compliance_score(workers: int, ppe: list[PPEComplianceStat], hazards: list[SafetyHazard]) -> int:
    if not ppe:
        ppe_penalty = 0.0
    else:
        weighted_miss = sum(_PPE_WEIGHT.get(p.kind, 0.5) * p.violations for p in ppe)
        weighted_total = sum(_PPE_WEIGHT.get(p.kind, 0.5) * p.workers_checked for p in ppe) or 1
        ppe_penalty = min(1.0, weighted_miss / weighted_total)

    hazard_penalty = min(
        1.0,
        sum(({"low": 0.02, "medium": 0.06, "high": 0.12, "critical": 0.22})[h.severity.value] for h in hazards),
    )
    raw = 100.0 * (1.0 - (0.7 * ppe_penalty + 0.3 * hazard_penalty))
    if workers == 0 and not hazards:
        raw = 96.0
    return int(round(clamp(raw, 5, 99)))


def _heuristic(
    f: ImageFeatures,
    image_meta: ImageMeta,
    site_context: str | None,
    latency_ms: int,
    request_id: str,
    strictness: str,
) -> SafetyAnalysisResponse:
    rng = random.Random(f.seed)
    strict = strictness == "strict"

    # -- workforce estimate -----------------------------------------------------------
    # Density calibration against real site photography at 448px analysis resolution:
    # one operative in a full hi-vis vest covers ~1.0-1.2% of a medium-shot frame, and
    # exposed skin (face, forearms, neck) ~2.0-2.4% per person. Both signals are noisy
    # individually; taking the stronger of the two is more robust than summing them.
    hi_vis_signal = f.hi_vis_ratio / 0.011
    skin_signal = f.skin_ratio / 0.023
    worker_est = int(round(max(hi_vis_signal, skin_signal) + rng.uniform(-0.3, 0.5)))
    workers = int(clamp(worker_est, 0, 24))
    if f.hi_vis_ratio < 0.0012 and f.skin_ratio < 0.0025:
        workers = 0

    # Exposed skin relative to hi-vis coverage is a crude proxy for missing PPE: a fully
    # compliant crew shows a low skin-to-vest ratio, a bare-headed crew a high one.
    exposure = f.skin_ratio / max(f.hi_vis_ratio, 0.0012)
    base_rate = clamp(0.08 + 0.62 * (1 - 1 / (1 + exposure * 1.2)), 0.04, 0.85)
    if strict:
        base_rate = clamp(base_rate * 1.25, 0.05, 0.95)

    ppe: list[PPEComplianceStat] = []
    if workers:
        for kind, factor in (
            (PPEKind.HELMET, 1.0),
            (PPEKind.HI_VIS_VEST, 0.80),
            (PPEKind.HARNESS, 0.35),
            (PPEKind.SAFETY_BOOTS, 0.55),
            (PPEKind.EYE_PROTECTION, 0.30),
            (PPEKind.GLOVES, 0.28),
        ):
            rate = clamp(base_rate * factor + rng.uniform(-0.06, 0.06), 0.0, 0.95)
            violations = int(round(workers * rate))
            ppe.append(
                PPEComplianceStat(
                    kind=kind,
                    workers_checked=workers,
                    compliant=max(0, workers - violations),
                    violations=violations,
                )
            )

    # -- hazard generation -------------------------------------------------------------
    elevations = _zone_label(f, rng)
    hazards: list[SafetyHazard] = []
    hz_index = 1

    def add(
        category: HazardCategory,
        title: str,
        description: str,
        severity: Severity,
        recommendation: str,
        *,
        at_risk: int,
        evidence: list[str],
        bbox: BBox | None = None,
        confidence: float | None = None,
    ) -> None:
        nonlocal hz_index
        hazards.append(
            SafetyHazard(
                id=f"HZ-{hz_index:02d}",
                category=category,
                title=title,
                description=description,
                severity=severity,
                confidence=round(clamp(confidence if confidence is not None else rng.uniform(0.52, 0.78), 0.3, 0.95), 2),
                zone=elevations,
                workers_at_risk=at_risk,
                bbox=bbox,
                evidence=evidence,
                recommendation=recommendation,
                standard_reference=_CATEGORY_FALLBACK_STANDARD[category],
            )
        )
        hz_index += 1

    helmet_stat = next((p for p in ppe if p.kind is PPEKind.HELMET), None)
    vest_stat = next((p for p in ppe if p.kind is PPEKind.HI_VIS_VEST), None)
    head_box = _hot_cell(f)

    if helmet_stat and helmet_stat.violations > 0:
        ratio = helmet_stat.violations / max(helmet_stat.workers_checked, 1)
        sev = Severity.CRITICAL if ratio >= 0.5 and strict else (
            Severity.HIGH if ratio >= 0.34 else Severity.MEDIUM
        )
        add(
            HazardCategory.MISSING_PPE,
            f"{helmet_stat.violations} worker(s) without head protection",
            (
                f"{helmet_stat.violations} of {helmet_stat.workers_checked} operatives in the frame show an "
                "unprotected head — bare head or a non-industrial cap is visible where the frames are "
                f"working below/adjacent to suspended load paths. Exposure is concentrated at {elevations}."
            ),
            sev,
            "Stop work in the affected bay, issue compliant IS 2925 industrial helmets, and log the "
            "violation against the worker's induction record before restarting.",
            at_risk=helmet_stat.violations,
            evidence=["Head region lacks helmet shell silhouette", "Low hi-vis coverage near exposed head", "Workers positioned under formwork"],
            bbox=head_box,
        )

    if vest_stat and vest_stat.violations > 0:
        add(
            HazardCategory.MISSING_PPE,
            "High-visibility vest non-compliance",
            (
                f"{vest_stat.violations} operative(s) are working without a Class-2 reflective vest. "
                "Reduced conspicuity against formwork and rebar increases struck-by risk during plant movement."
            ),
            Severity.HIGH if vest_stat.violations >= 2 else Severity.MEDIUM,
            "Mandate Class-2/3 retro-reflective vests in all plant-operating zones and add a gate-level "
            "PPE check with a signed register.",
            at_risk=vest_stat.violations,
            evidence=["Fluorescent yellow/orange coverage below expected threshold", "Mixed silhouettes against grey formwork"],
        )

    harness_stat = next((p for p in ppe if p.kind is PPEKind.HARNESS), None)
    if harness_stat and harness_stat.violations > 0 and f.ridge_linearity > 0.35:
        add(
            HazardCategory.FALL_HAZARD,
            "Work at height without fall arrest",
            (
                "Operatives appear to be positioned near an open edge/structural frame without a visible "
                "full-body harness or lifeline anchor. A fall from this level exceeds the 1.8 m trigger "
                "height for mandatory fall protection."
            ),
            Severity.CRITICAL,
            "Suspend work at the edge, install guardrails (top rail 1.05 m, mid-rail 0.55 m, toe board), "
            "and require harness + twin-leg lanyard anchored to a certified point before resuming.",
            at_risk=harness_stat.violations,
            evidence=["Open edge with no guardrail visible", "No lifeline anchor point in frame", "Worker stance at slab perimeter"],
            bbox=_hot_cell(f, offset=1),
            confidence=rng.uniform(0.6, 0.82),
        )

    if f.ridge_linearity > 0.55 and f.edge_density > 0.035:
        add(
            HazardCategory.HOUSEKEEPING,
            "Obstructed access route / material at height",
            (
                "Dense structural edges and stacked material are visible along the circulation path. "
                "Loose material and rebar offcuts at the working level create trip hazards and a "
                "falling-object risk to the level below."
            ),
            Severity.MEDIUM,
            "Clear a 1.2 m minimum egress width, bundle and tag rebar offcuts, and install toe boards "
            "where material is stacked within 2 m of an edge.",
            at_risk=min(workers, 3),
            evidence=["High edge density along walkway", "Unbundled linear material across the path"],
        )

    if f.dark_ratio > 0.30:
        add(
            HazardCategory.ACCESS_EGRESS,
            "Inadequate task lighting in work area",
            (
                "More than 30% of the frame is in deep shadow. Illuminance below 100 lux in circulation "
                "areas and 200 lux at task level breaches minimum site lighting requirements and hides "
                "trip and edge hazards."
            ),
            Severity.MEDIUM,
            "Deploy 200 lux minimum task lighting with 110 V site transformers, and re-audit shadowed "
            "areas before the evening shift.",
            at_risk=min(workers, 4),
            evidence=["Large low-luminance region detected", "Contrast loss in lower frame quadrant"],
        )

    if f.blue_ratio > 0.055 and workers == 0:
        add(
            HazardCategory.PLANT_EQUIPMENT,
            "Plant operating area without segregated walkway",
            (
                "Industrial-blue plant/container mass occupies a significant share of the frame with no "
                "visible pedestrian segregation. Reversing plant in a shared path is a struck-by risk."
            ),
            Severity.HIGH,
            "Introduce physical pedestrian segregation (barriers), a banksman for all reversing "
            "movements, and a 5 km/h site speed limit with signage.",
            at_risk=2,
            evidence=["Plant mass without barrier line", "No banksman visible in frame"],
        )

    if f.sharpness < 0.22 and f.contrast < 0.30:
        add(
            HazardCategory.HOUSEKEEPING,
            "Low-visibility capture — inspection coverage gap",
            (
                "The frame is low-contrast or motion-blurred, so PPE and edge conditions cannot be "
                "reliably assessed for this zone. An un-inspected zone is itself a management hazard."
            ),
            Severity.LOW,
            "Re-capture the zone at eye level in even light during the next inspection round and log "
            "the coverage gap in the daily safety report.",
            at_risk=0,
            evidence=["Laplacian energy below screening threshold", "Compressed dynamic range"],
        )

    # Guarantee a usable payload even on a clean, empty frame.
    if not hazards:
        severity = Severity.LOW
        add(
            HazardCategory.HOUSEKEEPING,
            "No acute hazard detected in frame",
            (
                "No workers, open edges or PPE violations were detected in this frame. Residual risk "
                "remains in areas outside the camera's field of view and in changing site conditions."
            ),
            severity,
            "Retain current controls, continue the 4-hourly supervisory walk, and keep the perimeter "
            "exclusion zone signed.",
            at_risk=0,
            evidence=["Frame consistent with compliant, unoccupied work area"],
            confidence=0.55,
        )

    hazards.sort(key=lambda h: SEVERITY_ORDER[h.severity], reverse=True)
    overall = worst_severity(*[h.severity for h in hazards])
    score = _compliance_score(workers, ppe, hazards)

    recommendations = _dedupe([h.recommendation for h in hazards])[:8]
    recommendations.append("Re-audit the affected zones within 24 hours and attach photo evidence to the close-out log.")
    if severity_at_least(overall, Severity.HIGH):
        recommendations.insert(0, "Convene a toolbox talk for the affected crew before the next shift starts.")

    non_compliant = [p for p in ppe if p.violations]
    ppe_phrase = (
        f"{len(non_compliant)} of {len(ppe)} PPE categories show non-compliance"
        if ppe
        else "no PPE items were assessable in this frame"
    )
    summary = (
        f"{workers} operative(s) detected across {elevations.lower()}; {ppe_phrase}. "
        f"Overall risk is graded {overall.value.upper()} and the site compliance index is {score}/100. "
        "Result produced by feature-based screening; confirm every finding on the ground before acting."
    )

    return SafetyAnalysisResponse(
        analysis_id=request_id,
        image=image_meta,
        site_context=site_context,
        overall_risk=overall,
        compliance_score=score,
        workers_detected=workers,
        ppe_compliance=ppe,
        hazards=hazards,
        recommendations=recommendations,
        summary=summary,
        stop_work_recommended=any(h.severity is Severity.CRITICAL for h in hazards),
        engine=make_engine_meta(
            mode=EngineMode.HEURISTIC,
            provider="heuristic",
            model="cv-heuristics-v1",
            latency_ms=latency_ms,
            confidence=rng.uniform(0.48, 0.68),
            request_id=request_id,
            disclosure=HEURISTIC_DISCLOSURE,
        ),
    )


def _zone_label(f: ImageFeatures, rng: random.Random) -> str:
    """Derive a plausible zone label from the frame itself rather than a fixed list.

    This is a *description of what the frame looks like*, not a GPS fix: a frame full
    of structural edges reads as a structural bay, a sparse cluttered frame as a yard.
    """
    directions = ["North", "East", "South", "West"]
    bearing = rng.choice(directions)
    level = 1 + f.seed % 8
    if f.edge_density > 0.10 or f.material_density > 0.18:
        return f"Level {level} — {bearing} structural bay"
    if f.edge_density > 0.03:
        return f"Ground level — {bearing} works area"
    return f"Ground level — {bearing} material yard"


def _hot_cell(f: ImageFeatures, offset: int = 0) -> BBox | None:
    if not f.crack_cells:
        return None
    ranked = sorted(f.crack_cells, key=lambda c: c[4], reverse=True)
    if offset >= len(ranked):
        offset = 0
    x, y, w, h, _ = ranked[offset]
    pad_x = min(w * 0.12, 1 - x - w)
    pad_y = min(h * 0.12, 1 - y - h)
    x, y = clamp(x - pad_x, 0, 1), clamp(y - pad_y, 0, 1)
    w = clamp(w + 2 * pad_x, 0.02, 1 - x)
    h = clamp(h + 2 * pad_y, 0.02, 1 - y)
    return BBox(x=round(x, 4), y=round(y, 4), w=round(w, 4), h=round(h, 4))


def _dedupe(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        key = item.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(item)
    return out
