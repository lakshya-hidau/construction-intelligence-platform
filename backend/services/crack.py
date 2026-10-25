"""
Module 2 — Crack Detection & Structural Analysis.

The heuristic path infers crack geometry from Sobel ridge statistics (density,
linearity, dominant orientation, and the spatial concentration of ridges), then maps
that geometry onto ACI 224.1R / IS 456 / EN 1504 severity banding. The LLM path asks a
multimodal model for the same fields; the server then re-derives severity from the
reported width so a model cannot contradict the width classification rule.
"""

from __future__ import annotations

import time
from typing import Any

from models.schemas import (
    BBox,
    CrackAnalysisResponse,
    CrackMeasurement,
    CrackSeverity,
    CrackType,
    EngineMode,
    ImageMeta,
    RemediationAction,
    SurfaceType,
)
from services.common import (
    HEURISTIC_DISCLOSURE,
    LLM_DISCLOSURE,
    clamp,
    make_engine_meta,
)
from services.image_ops import ImageFeatures, decode_image, encode_jpeg, extract_features
from services.llm import LLMError, VisionImage, get_llm

SYSTEM_PROMPT = """You are a chartered structural engineer specialising in condition surveys of \
reinforced concrete and masonry. You assess crack patterns against ACI 224.1R, IS 456:2000 and \
EN 1504. You distinguish cosmetic shrinkage cracking from structurally significant distress, and \
you never overstate certainty from a single photograph. You answer with one JSON object only."""

USER_PROMPT = """Analyse the structural distress visible in this image.

Surface type hint: {surface_type}
Engineer's note: {notes}

Return JSON with exactly this shape:
{{
  "surface_type": "concrete_column|concrete_beam|slab_soffit|masonry_wall|retaining_wall|plaster_render|pavement_hardstand|unknown",
  "crack_type": "hairline|shrinkage|flexural|diagonal_shear|settlement|map_cracking|corrosion_induced|thermal|none_observed",
  "estimated_width_mm": <float 0-100>,
  "estimated_length_m": <float 0-100>,
  "orientation_deg": <float 0-180>,
  "branching": <bool>,
  "spalling_present": <bool>,
  "efflorescence": <bool>,
  "structural_implication": "<what the pattern implies about load path, settlement or durability>",
  "is_structurally_significant": <bool>,
  "requires_engineer_review": <bool>,
  "detections": [{{"x": <0-1>, "y": <0-1>, "w": <0-1>, "h": <0-1>, "label": "<e.g. main diagonal crack>"}}],
  "remediation": [
    {{"priority": "immediate|short_term|monitor",
      "action": "<short action>",
      "detail": "<method statement level detail>",
      "timeframe": "<e.g. within 24 hours>",
      "standard_reference": "<ACI/IS/EN clause>",
      "estimated_cost_band": "low|medium|high"}}
  ],
  "monitoring_plan": "<instrumentation and inspection frequency>",
  "summary": "<2-4 sentence findings summary>"
}}

Rules:
- Diagonal shear cracking in a beam/column, or any crack wider than 3 mm, is CRITICAL.
- A crack is only structurally significant if it affects the load path, durability or serviceability.
- If no crack is visible, set crack_type to "none_observed" and say so in the summary.
"""

_SURFACE_LABEL: dict[SurfaceType, str] = {
    SurfaceType.CONCRETE_COLUMN: "concrete column",
    SurfaceType.CONCRETE_BEAM: "concrete beam",
    SurfaceType.SLAB_SOFFIT: "slab soffit",
    SurfaceType.MASONRY_WALL: "masonry wall",
    SurfaceType.RETAINING_WALL: "retaining wall",
    SurfaceType.PLASTER_RENDER: "plaster / render",
    SurfaceType.PAVEMENT_HARDSTAND: "pavement / hardstand",
    SurfaceType.UNKNOWN: "unknown surface",
}


def analyze_crack(
    raw: bytes,
    *,
    filename: str,
    content_type: str,
    notes: str | None,
    surface_hint: SurfaceType,
    request_id: str,
) -> CrackAnalysisResponse:
    started = time.perf_counter()
    img = decode_image(raw)
    features = extract_features(img, raw)
    image_meta = ImageMeta(
        filename=filename, width=img.width, height=img.height, bytes=len(raw), content_type=content_type
    )

    client = get_llm()
    if client.available:
        try:
            payload, result = client.vision_json(
                SYSTEM_PROMPT,
                USER_PROMPT.format(surface_type=surface_hint.value, notes=notes or "none"),
                [VisionImage(encode_jpeg(img), "image/jpeg")],
            )
            return _from_llm(
                payload, image_meta, surface_hint, result.latency_ms, request_id, client.provider, client.model
            )
        except (LLMError, ValueError, KeyError, TypeError):
            pass

    latency_ms = int((time.perf_counter() - started) * 1000)
    return _heuristic(features, image_meta, surface_hint, latency_ms, request_id)


# --------------------------------------------------------------------------------------
# Shared grading logic
# --------------------------------------------------------------------------------------


def _width_class(width_mm: float) -> str:
    if width_mm < 0.1:
        return "hairline"
    if width_mm < 0.3:
        return "fine"
    if width_mm < 1.0:
        return "moderate"
    if width_mm < 3.0:
        return "wide"
    return "severe"


def _grade(width_mm: float, crack_type: CrackType, structural: bool) -> tuple[CrackSeverity, int]:
    """Deterministic severity from width + pattern type. This is the source of truth.

    Shear and settlement patterns are escalated because their failure mode is brittle:
    a 1.5 mm diagonal crack in a shear span is a far greater concern than a 2 mm
    shrinkage crack in plaster, even though the latter is nominally wider.
    """
    if width_mm >= 3.0:
        base = CrackSeverity.CRITICAL
    elif crack_type in {CrackType.DIAGONAL_SHEAR, CrackType.SETTLEMENT} and width_mm >= 1.5:
        base = CrackSeverity.CRITICAL
    elif crack_type is CrackType.MAP_CRACKING and width_mm >= 2.0:
        base = CrackSeverity.CRITICAL
    elif width_mm >= 0.75 or (crack_type is CrackType.CORROSION_INDUCED and width_mm >= 0.4):
        base = CrackSeverity.MEDIUM
    elif structural:
        base = CrackSeverity.MEDIUM
    else:
        base = CrackSeverity.LOW

    score = int(round(clamp(18 + width_mm * 17 + (12 if structural else 0), 3, 100)))
    if base is CrackSeverity.CRITICAL:
        score = max(score, 78)
    elif base is CrackSeverity.MEDIUM:
        score = max(score, 45)
    return base, score


def _default_remediation(
    severity: CrackSeverity, crack_type: CrackType, width_mm: float, surface: SurfaceType
) -> list[RemediationAction]:
    actions: list[RemediationAction] = []

    if severity is CrackSeverity.CRITICAL:
        actions.append(
            RemediationAction(
                priority="immediate",
                action="Prohibit access and prop/shore the affected member",
                detail=(
                    "Barricade the area, install documented temporary propping or shoring under the "
                    "affected member, and commission a full structural assessment by a licensed "
                    "engineer including rebound-hammer / UPV testing before any load is reintroduced."
                ),
                timeframe="within 24 hours",
                standard_reference="IS 456:2000 Cl. 34 / ACI 224.1R §5.4 / EN 1504-4",
                estimated_cost_band="high",
            )
        )
        actions.append(
            RemediationAction(
                priority="immediate",
                action="Install crack gauges and monitor movement",
                detail=(
                    "Fix demountable mechanical (DEMEC) gauge studs or a calibrated crack width gauge "
                    "across the crack at 3 locations; record width and length at 0, 7, 14 and 28 days. "
                    "Movement greater than 0.1 mm/week triggers escalation to the structural engineer."
                ),
                timeframe="immediate, then weekly",
                standard_reference="ACI 224.1R §7 / IS 13311 (Part 1)",
                estimated_cost_band="low",
            )
        )
        actions.append(
            RemediationAction(
                priority="short_term",
                action="Structural repair: epoxy injection / jacketing",
                detail=(
                    "After assessment, inject low-viscosity structural epoxy along the full crack depth "
                    "under pressure, or design a fibre-wrapped (CFRP) / RC jacketed repair where the "
                    "section capacity is deficient."
                ),
                timeframe="within 2-6 weeks",
                standard_reference="ACI 503R / EN 1504-5 / ACI 440.2R",
                estimated_cost_band="high",
            )
        )

    elif severity is CrackSeverity.MEDIUM:
        actions.append(
            RemediationAction(
                priority="short_term",
                action="Waterproof and seal the crack",
                detail=(
                    "Route and clean the crack, then seal with a flexible polyurethane or polymer-modified "
                    "cementitious sealant to arrest water ingress and carbonation. Measure width monthly "
                    "for 3 months to confirm the crack is dormant before sealing."
                ),
                timeframe="within 2-4 weeks",
                standard_reference="EN 1504-3 / IS 456:2000 Cl. 13.4",
                estimated_cost_band="medium",
            )
        )
        actions.append(
            RemediationAction(
                priority="monitor",
                action="Establish a 90-day monitoring baseline",
                detail=(
                    "Record crack width, depth and pattern monthly for 90 days. Investigate the underlying "
                    "cause (thermal movement, restrained shrinkage, differential settlement) before "
                    "specifying any structural repair."
                ),
                timeframe="next 90 days",
                standard_reference="ACI 224.1R §7",
                estimated_cost_band="low",
            )
        )

    else:
        actions.append(
            RemediationAction(
                priority="monitor",
                action="Observe and log as non-structural",
                detail=(
                    f"Hairline / fine cracking below 0.3 mm on {_SURFACE_LABEL[surface]} is typically "
                    "cosmetic shrinkage or settlement of the render. Photograph with a scale reference at "
                    "0, 3 and 6 months; repair only if the width grows or water ingress appears."
                ),
                timeframe="6-month observation",
                standard_reference="ACI 224.1R §4.3 / IS 456:2000 Annex B",
                estimated_cost_band="low",
            )
        )
        if crack_type in {CrackType.SHRINKAGE, CrackType.THERMAL}:
            actions.append(
                RemediationAction(
                    priority="monitor",
                    action="Surface decoration and crack-bridging coating",
                    detail=(
                        "When decoration is scheduled, apply an elastomeric crack-bridging paint and an "
                        "alkali-resistant glass-fibre mesh scrim over the pattern zone to hide recurrence."
                    ),
                    timeframe="with next decoration cycle",
                    standard_reference="EN 1504-2 / IS 2393",
                    estimated_cost_band="low",
                )
            )

    if crack_type is CrackType.CORROSION_INDUCED:
        actions.append(
            RemediationAction(
                priority="short_term",
                action="Address reinforcement corrosion",
                detail=(
                    "Break out cover around the affected bars, mechanically wire-brush to SA 2.5, and "
                    "reinstate with a zinc-rich primer plus low-permeability structural repair mortar. "
                    "Confirm remaining bar diameter with a cover-meter survey."
                ),
                timeframe="within 3-4 weeks",
                standard_reference="EN 1504-9 / ACI 546R",
                estimated_cost_band="medium",
            )
        )

    return actions


# --------------------------------------------------------------------------------------
# LLM path
# --------------------------------------------------------------------------------------


def _safe_detections(value: Any) -> list[BBox]:
    out: list[BBox] = []
    for item in value or []:
        if not isinstance(item, dict):
            continue
        try:
            x = clamp(float(item.get("x", 0)), 0, 1)
            y = clamp(float(item.get("y", 0)), 0, 1)
            w = clamp(float(item.get("w", 0.05)), 0.01, 1 - x) if x < 1 else 0.01
            h = clamp(float(item.get("h", 0.05)), 0.01, 1 - y) if y < 1 else 0.01
            out.append(BBox(x=round(x, 4), y=round(y, 4), w=round(w, 4), h=round(h, 4), label=str(item.get("label") or "")[:80] or None))
        except (TypeError, ValueError):
            continue
        if len(out) >= 20:
            break
    return out


def _from_llm(
    payload: dict[str, Any],
    image_meta: ImageMeta,
    surface_hint: SurfaceType,
    latency_ms: int,
    request_id: str,
    provider: str,
    model: str,
) -> CrackAnalysisResponse:
    try:
        surface = SurfaceType(str(payload.get("surface_type", surface_hint.value)).lower())
    except ValueError:
        surface = surface_hint
    try:
        crack_type = CrackType(str(payload.get("crack_type", "unknown")).lower())
    except ValueError:
        crack_type = CrackType.SHRINKAGE

    width = float(clamp(float(payload.get("estimated_width_mm", 0.3) or 0.3), 0, 500))
    length = float(clamp(float(payload.get("estimated_length_m", 1.0) or 1.0), 0, 500))
    orientation = float(clamp(float(payload.get("orientation_deg", 90) or 90), 0, 180))
    branching = bool(payload.get("branching", False))
    spalling = bool(payload.get("spalling_present", False))
    efflorescence = bool(payload.get("efflorescence", False))

    structural = bool(payload.get("is_structurally_significant", width >= 0.75))
    if spalling and width >= 0.75:
        structural = True

    severity, score = _grade(width, crack_type, structural)

    remediation: list[RemediationAction] = []
    for raw_action in payload.get("remediation") or []:
        if not isinstance(raw_action, dict):
            continue
        priority = str(raw_action.get("priority", "monitor")).lower()
        if priority not in {"immediate", "short_term", "monitor"}:
            priority = "monitor"
        detail = str(raw_action.get("detail") or "")
        if len(detail) < 10:
            detail = (detail + " Refer to the cited standard for the full method statement.").strip()
        cost_band = str(raw_action.get("estimated_cost_band") or "").lower() or None
        if cost_band not in {"low", "medium", "high"}:
            cost_band = None
        try:
            remediation.append(
                RemediationAction(
                    priority=priority,
                    action=str(raw_action.get("action") or "Repair per engineer's instruction")[:300],
                    detail=detail[:900],
                    timeframe=str(raw_action.get("timeframe") or "as scheduled")[:80],
                    standard_reference=str(raw_action.get("standard_reference") or "Site-specific method statement")[:200],
                    estimated_cost_band=cost_band,
                )
            )
        except ValueError:
            continue
    if not remediation:
        remediation = _default_remediation(severity, crack_type, width, surface)

    implication = str(payload.get("structural_implication") or "").strip()
    if len(implication) < 10:
        implication = (
            f"A {width:.2f} mm {crack_type.value.replace('_', ' ')} crack on {_SURFACE_LABEL[surface]} "
            "was reported without a load-path assessment; confirm with a site inspection."
        )

    monitoring = str(payload.get("monitoring_plan") or "").strip()
    if len(monitoring) < 10:
        monitoring = (
            "Photograph the crack with a scale reference at 0/7/28 days and record width with a crack "
            "comparator gauge. Escalate if width grows by more than 0.1 mm in any 7-day window."
        )

    summary = str(payload.get("summary") or "").strip()
    if len(summary) < 10:
        summary = (
            f"{crack_type.value.replace('_', ' ').capitalize()} pattern on {_SURFACE_LABEL[surface]} "
            f"measured at approximately {width:.2f} mm, graded {severity.value.upper()}."
        )

    return CrackAnalysisResponse(
        analysis_id=request_id,
        image=image_meta,
        surface_type=surface,
        crack_type=crack_type,
        severity=severity,
        severity_score=score,
        width_class=_width_class(width),  # type: ignore[arg-type]
        measurement=CrackMeasurement(
            estimated_width_mm=round(width, 3),
            estimated_length_m=round(length, 2),
            orientation_deg=round(orientation, 1),
            branching=branching,
            spalling_present=spalling,
            efflorescence=efflorescence,
        ),
        detections=_safe_detections(payload.get("detections")),
        structural_implication=implication[:1200],
        is_structurally_significant=structural,
        requires_engineer_review=bool(payload.get("requires_engineer_review", severity is CrackSeverity.CRITICAL)),
        remediation=remediation[:10],
        monitoring_plan=monitoring[:1000],
        summary=summary[:1600],
        engine=make_engine_meta(
            mode=EngineMode.LLM,
            provider=provider,
            model=model,
            latency_ms=latency_ms,
            confidence=0.72 if severity is not CrackSeverity.CRITICAL else 0.8,
            request_id=request_id,
            disclosure=LLM_DISCLOSURE,
        ),
    )


# --------------------------------------------------------------------------------------
# Heuristic path
# --------------------------------------------------------------------------------------


def _classify_type(
    density: float,
    coherence: float,
    spread: float,
    angle: float,
    spalling: bool,
    brightness: float,
    width_mm: float,
) -> CrackType:
    """Map thin-dark-feature statistics onto a crack pattern classification.

    `density`    = fraction of pixels flagged by the black-hat detector
    `coherence`  = how strongly those features align into a line (0 = chaotic)
    `angle`      = dominant ridge orientation in degrees to horizontal
    """
    if density < 0.004:
        return CrackType.NONE_OBSERVED
    # Chaotic, interconnected network rather than a directed line: crack activity is
    # smeared across most of the surface AND the features do not align.
    if spread >= 0.72 and coherence < 0.45 and density > 0.03:
        return CrackType.MAP_CRACKING
    if spalling and density > 0.06:
        return CrackType.CORROSION_INDUCED
    # Hairline crazing only if the derived width is genuinely hairline (<0.2 mm);
    # otherwise a low-density but wider single crack is a shrinkage crack.
    if width_mm < 0.20:
        return CrackType.HAIRLINE
    # Diagonal (shear) band: 25-65 degrees to the member axis.
    if 25 <= angle <= 65:
        return CrackType.DIAGONAL_SHEAR
    # Near-vertical: settlement if highly coherent, otherwise restrained shrinkage.
    if 75 <= angle <= 105:
        return CrackType.SETTLEMENT if coherence > 0.55 else CrackType.SHRINKAGE
    if brightness > 0.74 and coherence < 0.50:
        return CrackType.THERMAL
    return CrackType.FLEXURAL if coherence > 0.50 else CrackType.SHRINKAGE


def _infer_surface(f: ImageFeatures, hint: SurfaceType) -> SurfaceType:
    if hint is not SurfaceType.UNKNOWN:
        return hint
    if f.brightness > 0.78 and f.contrast < 0.25:
        return SurfaceType.PLASTER_RENDER
    if f.edge_density > 0.10:
        return SurfaceType.MASONRY_WALL
    if f.material_density > 0.12:
        return SurfaceType.CONCRETE_BEAM
    return SurfaceType.CONCRETE_COLUMN


def _crack_bboxes(f: ImageFeatures, limit: int = 3) -> list[BBox]:
    if not f.crack_cells:
        return []
    ranked = sorted(f.crack_cells, key=lambda c: c[4], reverse=True)[:limit]
    boxes: list[BBox] = []
    for idx, (x, y, w, h, score) in enumerate(ranked):
        if score < 1e-4:
            continue
        boxes.append(
            BBox(
                x=round(x, 4),
                y=round(y, 4),
                w=round(w, 4),
                h=round(h, 4),
                label="Primary crack trace" if idx == 0 else f"Secondary crack trace {idx}",
            )
        )
    return boxes


def _heuristic(
    f: ImageFeatures,
    image_meta: ImageMeta,
    hint: SurfaceType,
    latency_ms: int,
    request_id: str,
) -> CrackAnalysisResponse:
    surface = _infer_surface(f, hint)
    density = f.crack_density
    coherence = f.crack_coherence
    angle = f.dominant_angle_deg
    spalling = f.contrast > 0.55 and density > 0.05
    efflorescence = f.brightness > 0.82 and density > 0.03

    # Width proxy: calibrated so a plainly visible 1-2 mm crack on a close-up surface
    # (crack density ~0.05-0.10 of frame pixels) lands in the 1.0-2.0 mm band, and
    # faint crazing (density ~0.005) lands as hairline. Assumes the frame spans a
    # 1.5-3 m surface patch; the UI labels the value "estimated".
    width_mm = round(clamp(0.06 + (density ** 0.62) * 8.0, 0.05, 12.0), 2)
    length_m = round(clamp(0.25 + density * 25.0 * (0.6 + coherence), 0.1, 14.0), 2)

    crack_type = _classify_type(
        density, coherence, f.crack_spread, angle, spalling, f.brightness, width_mm
    )

    structural = crack_type in {
        CrackType.DIAGONAL_SHEAR,
        CrackType.SETTLEMENT,
        CrackType.MAP_CRACKING,
    } and width_mm >= 0.6
    if spalling:
        structural = structural or width_mm >= 1.2

    severity, score = _grade(width_mm, crack_type, structural)
    if crack_type is CrackType.NONE_OBSERVED:
        severity, score = CrackSeverity.LOW, 5
        width_mm = 0.02
        length_m = 0.0
        structural = False

    remediation = _default_remediation(severity, crack_type, width_mm, surface)

    implication = {
        CrackType.NONE_OBSERVED: (
            "No coherent crack pattern was detected above the screening threshold. The surface appears "
            "sound in this frame; no structural implication is inferred."
        ),
        CrackType.DIAGONAL_SHEAR: (
            "A diagonal (shear-oriented) crack trace is present. Diagonal cracking in a beam or column "
            "indicates shear demand approaching or exceeding the concrete's diagonal tension capacity and "
            "may precede a brittle failure — this requires immediate engineering review."
        ),
        CrackType.SETTLEMENT: (
            "Near-vertical, coherent cracks suggest differential settlement of the support or foundation. "
            "The risk is progressive: further settlement will widen the crack and rotate the member."
        ),
        CrackType.MAP_CRACKING: (
            "A chaotic, interconnected crack network is present. This is consistent with alkali-aggregate "
            "reaction, over-trowelled or overly rich mixes, or restrained drying shrinkage — a durability "
            "rather than an immediate load-path concern."
        ),
        CrackType.CORROSION_INDUCED: (
            "Cracking accompanied by spalling and/or staining is consistent with reinforcement corrosion. "
            "Expansive corrosion products split the cover; the section loss is the real capacity concern."
        ),
        CrackType.THERMAL: (
            "Long, regularly spaced cracks on a bright/high-exposure surface are consistent with restrained "
            "thermal movement rather than structural overload."
        ),
        CrackType.FLEXURAL: (
            "Cracks perpendicular to the member axis are consistent with flexural action. At this width "
            "they are within the serviceability allowance but should be tracked."
        ),
        CrackType.SHRINKAGE: (
            "Fine, irregular cracks are consistent with plastic/drying shrinkage of the concrete or render. "
            "Typically cosmetic, but they open a path for water and carbonation ingress."
        ),
        CrackType.HAIRLINE: (
            "Hairline surface crazing only. No load-path implication at this scale; a cosmetic and "
            "durability observation."
        ),
    }[crack_type]

    monitoring = {
        CrackSeverity.CRITICAL: (
            "Install DEMEC studs or tell-tale gauges at three points along the crack. Record width, "
            "length and relative displacement at 0, 3, 7, 14 and 28 days; escalate to the structural "
            "engineer if movement exceeds 0.1 mm/week or the pattern propagates."
        ),
        CrackSeverity.MEDIUM: (
            "Measure with a crack-width comparator and photograph with a scale rule monthly for 3 months. "
            "If the crack is dormant, seal it; if active, investigate the movement source."
        ),
        CrackSeverity.LOW: (
            "Visual observation at the next scheduled inspection (or 6 months). Photograph with a scale "
            "reference to build a baseline for comparison."
        ),
    }[severity]

    summary = (
        f"{crack_type.value.replace('_', ' ').title()} pattern identified on {_SURFACE_LABEL[surface]}. "
        f"Estimated width {width_mm:.2f} mm ({_width_class(width_mm)}) over approximately {length_m:.1f} m, "
        f"dominant orientation {angle:.0f}°. Graded {severity.value.upper()} with a severity index of "
        f"{score}/100. Screen result only — verify scale on site before instructing repair."
    )

    return CrackAnalysisResponse(
        analysis_id=request_id,
        image=image_meta,
        surface_type=surface,
        crack_type=crack_type,
        severity=severity,
        severity_score=score,
        width_class=_width_class(width_mm),  # type: ignore[arg-type]
        measurement=CrackMeasurement(
            estimated_width_mm=width_mm,
            estimated_length_m=length_m,
            orientation_deg=round(angle, 1),
            branching=coherence > 0.55,
            spalling_present=spalling,
            efflorescence=efflorescence,
        ),
        detections=_crack_bboxes(f),
        structural_implication=implication,
        is_structurally_significant=structural,
        requires_engineer_review=severity is CrackSeverity.CRITICAL or structural,
        remediation=remediation,
        monitoring_plan=monitoring,
        summary=summary,
        engine=make_engine_meta(
            mode=EngineMode.HEURISTIC,
            provider="heuristic",
            model="cv-heuristics-v1",
            latency_ms=latency_ms,
            confidence=clamp(0.48 + coherence * 0.28, 0.4, 0.76),
            request_id=request_id,
            disclosure=HEURISTIC_DISCLOSURE,
        ),
    )
