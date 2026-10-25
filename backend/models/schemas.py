"""
Strict Pydantic v2 data contracts for the Multimodal Construction Intelligence Platform.

Every request and response crossing the API boundary is declared here. The frontend
types (see frontend/src/lib/contracts.js) mirror these models 1:1, so any drift is a
compile-time/validation error rather than a silent UI break.

Conventions
-----------
* All IDs are opaque strings (UUID4 hex where generated server-side).
* All normalized geometry is expressed in 0..1 image space, origin top-left.
* All money values are in the currency declared on the response (`INR` by default).
* `EngineMeta` is attached to every AI-derived payload so the UI can always disclose
  *which* engine produced an answer and how confident it is.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

# --------------------------------------------------------------------------------------
# Enumerations
# --------------------------------------------------------------------------------------


class Severity(str, Enum):
    """Shared severity ladder. Ordered from least to most urgent."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class CrackSeverity(str, Enum):
    """Crack module uses the three-band classification specified by the product brief."""

    LOW = "low"
    MEDIUM = "medium"
    CRITICAL = "critical"


class EngineMode(str, Enum):
    LLM = "llm"  # A real multimodal model produced the structured output
    HEURISTIC = "heuristic"  # Deterministic offline computer-vision fallback
    HYBRID = "hybrid"  # Heuristics primed the model / model refined heuristics


class PPEKind(str, Enum):
    HELMET = "helmet"
    HI_VIS_VEST = "hi_vis_vest"
    HARNESS = "harness"
    SAFETY_BOOTS = "safety_boots"
    EYE_PROTECTION = "eye_protection"
    GLOVES = "gloves"


class HazardCategory(str, Enum):
    MISSING_PPE = "missing_ppe"
    FALL_HAZARD = "fall_hazard"
    EDGE_PROTECTION = "edge_protection"
    SCAFFOLD_DEFECT = "scaffold_defect"
    HOUSEKEEPING = "housekeeping"
    ELECTRICAL = "electrical"
    PLANT_EQUIPMENT = "plant_equipment"
    EXCAVATION = "excavation"
    FIRE_SAFETY = "fire_safety"
    ACCESS_EGRESS = "access_egress"


class CrackType(str, Enum):
    HAIRLINE = "hairline"
    SHRINKAGE = "shrinkage"
    FLEXURAL = "flexural"
    DIAGONAL_SHEAR = "diagonal_shear"
    SETTLEMENT = "settlement"
    MAP_CRACKING = "map_cracking"
    CORROSION_INDUCED = "corrosion_induced"
    THERMAL = "thermal"
    NONE_OBSERVED = "none_observed"


class SurfaceType(str, Enum):
    CONCRETE_COLUMN = "concrete_column"
    CONCRETE_BEAM = "concrete_beam"
    SLAB_SOFFIT = "slab_soffit"
    MASONRY_WALL = "masonry_wall"
    RETAINING_WALL = "retaining_wall"
    PLASTER_RENDER = "plaster_render"
    PAVEMENT_HARDSTAND = "pavement_hardstand"
    UNKNOWN = "unknown"


class PropertyType(str, Enum):
    APARTMENT = "apartment"
    VILLA = "villa"
    COMMERCIAL_RETAIL = "commercial_retail"
    OFFICE = "office"
    INDUSTRIAL_WAREHOUSE = "industrial_warehouse"
    RESIDENTIAL_PLOT = "residential_plot"


class FinishGrade(str, Enum):
    BASIC = "basic"
    STANDARD = "standard"
    PREMIUM = "premium"
    LUXURY = "luxury"


class StructureType(str, Enum):
    RCC_FRAME = "rcc_frame"
    LOAD_BEARING = "load_bearing"
    STEEL_FRAME = "steel_frame"
    HYBRID = "hybrid"


class ProjectPhase(str, Enum):
    PLANNING = "planning"
    FOUNDATION = "foundation"
    STRUCTURE = "structure"
    ENVELOPE = "envelope"
    FINISHING = "finishing"
    HANDOVER = "handover"
    COMPLETED = "completed"


class ActivityType(str, Enum):
    CONCRETE_POUR = "concrete_pour"
    EXCAVATION = "excavation"
    MASONRY = "masonry"
    STEEL_ERECTION = "steel_erection"
    WATERPROOFING = "waterproofing"
    PAINTING = "painting"
    ROOFING = "roofing"
    GENERAL_SITE = "general_site"


class PermitStatus(str, Enum):
    GO = "go"
    CAUTION = "caution"
    HOLD = "hold"


class Trade(str, Enum):
    EARTHWORK = "earthwork"
    CONCRETE = "concrete"
    STEEL = "steel"
    MASONRY = "masonry"
    MEP = "mep"
    FINISHES = "finishes"
    EXTERNAL = "external"
    MANAGEMENT = "management"


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"


# --------------------------------------------------------------------------------------
# Shared primitives
# --------------------------------------------------------------------------------------


class APIModel(BaseModel):
    """Base model: forbids unknown fields so contract drift fails loudly."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class BBox(APIModel):
    """Normalized bounding box in 0..1 image coordinates (origin = top-left)."""

    x: Annotated[float, Field(ge=0, le=1)]
    y: Annotated[float, Field(ge=0, le=1)]
    w: Annotated[float, Field(gt=0, le=1)]
    h: Annotated[float, Field(gt=0, le=1)]
    label: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _within_frame(self) -> "BBox":
        if self.x + self.w > 1.0001 or self.y + self.h > 1.0001:
            raise ValueError("bounding box extends outside the normalized image frame")
        return self


class ImageMeta(APIModel):
    filename: str = Field(max_length=260)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    bytes: int = Field(gt=0)
    content_type: str = Field(max_length=100)


class EngineMeta(APIModel):
    """Provenance block attached to every AI-derived response."""

    engine_mode: EngineMode
    provider: str = Field(max_length=40, description="e.g. openai, anthropic, heuristic")
    model: str = Field(max_length=80)
    latency_ms: int = Field(ge=0)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    request_id: str = Field(max_length=64)
    confidence: float = Field(ge=0, le=1)
    disclosure: str = Field(
        max_length=400,
        description="Human-readable statement of how the result was produced.",
    )


class ErrorDetail(APIModel):
    code: str = Field(max_length=64)
    message: str = Field(max_length=600)
    field: str | None = Field(default=None, max_length=120)
    request_id: str | None = Field(default=None, max_length=64)


class ErrorResponse(APIModel):
    """Uniform error envelope. The axios client normalizes to this shape."""

    error: ErrorDetail
    status: int = Field(ge=400, le=599)


class HealthResponse(APIModel):
    status: Literal["ok", "degraded"]
    version: str
    engine_mode: EngineMode
    provider: str
    model: str
    vision_enabled: bool
    llm_configured: bool
    weather_provider: str
    uptime_seconds: int = Field(ge=0)
    knowledge_chunks: int = Field(ge=0)


# --------------------------------------------------------------------------------------
# Module 1 — Construction Site Safety Monitoring
# --------------------------------------------------------------------------------------


class PPEComplianceStat(APIModel):
    kind: PPEKind
    workers_checked: int = Field(ge=0)
    compliant: int = Field(ge=0)
    violations: int = Field(ge=0)

    @model_validator(mode="after")
    def _consistent_counts(self) -> "PPEComplianceStat":
        if self.compliant + self.violations > self.workers_checked:
            raise ValueError("compliant + violations cannot exceed workers_checked")
        return self

    @property
    def compliance_pct(self) -> float:
        if self.workers_checked == 0:
            return 100.0
        return round(100.0 * self.compliant / self.workers_checked, 1)


class SafetyHazard(APIModel):
    id: str = Field(max_length=40)
    category: HazardCategory
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=10, max_length=1200)
    severity: Severity
    confidence: float = Field(ge=0, le=1)
    zone: str = Field(max_length=120, description="Grid zone or area label, e.g. 'Level 3 - North Edge'")
    workers_at_risk: int = Field(ge=0, le=500)
    bbox: BBox | None = None
    evidence: list[str] = Field(default_factory=list, max_length=8)
    recommendation: str = Field(min_length=10, max_length=1200)
    standard_reference: str = Field(max_length=200)


class SafetyAnalysisResponse(APIModel):
    analysis_id: str
    image: ImageMeta
    site_context: str | None = Field(default=None, max_length=300)
    overall_risk: Severity
    compliance_score: int = Field(ge=0, le=100, description="0 = grossly non-compliant, 100 = fully compliant")
    workers_detected: int = Field(ge=0, le=500)
    ppe_compliance: list[PPEComplianceStat]
    hazards: list[SafetyHazard]
    recommendations: list[str] = Field(min_length=1, max_length=12)
    summary: str = Field(min_length=10, max_length=1600)
    stop_work_recommended: bool
    engine: EngineMeta

    @model_validator(mode="after")
    def _hazard_consistency(self) -> "SafetyAnalysisResponse":
        if any(h.severity is Severity.CRITICAL for h in self.hazards) and self.overall_risk is not Severity.CRITICAL:
            raise ValueError("overall_risk must be CRITICAL when a critical hazard is present")
        return self


class SafetyAnalysisRequestMeta(APIModel):
    """Non-file fields accepted alongside the multipart image upload."""

    site_context: str | None = Field(default=None, max_length=300)
    strictness: Literal["standard", "strict"] = "standard"


# --------------------------------------------------------------------------------------
# Module 2 — Crack Detection & Structural Analysis
# --------------------------------------------------------------------------------------


class CrackMeasurement(APIModel):
    estimated_width_mm: float = Field(ge=0, le=500)
    estimated_length_m: float = Field(ge=0, le=500)
    orientation_deg: float = Field(ge=0, le=180)
    branching: bool
    spalling_present: bool
    efflorescence: bool


class RemediationAction(APIModel):
    priority: Literal["immediate", "short_term", "monitor"]
    action: str = Field(min_length=5, max_length=300)
    detail: str = Field(min_length=10, max_length=900)
    timeframe: str = Field(max_length=80)
    standard_reference: str = Field(max_length=200)
    estimated_cost_band: Literal["low", "medium", "high"] | None = None


class CrackAnalysisResponse(APIModel):
    analysis_id: str
    image: ImageMeta
    surface_type: SurfaceType
    crack_type: CrackType
    severity: CrackSeverity
    severity_score: int = Field(ge=0, le=100)
    width_class: Literal["hairline", "fine", "moderate", "wide", "severe"] = Field(
        description="ACI 224 / IS 456 style width banding"
    )
    measurement: CrackMeasurement
    detections: list[BBox] = Field(default_factory=list, max_length=20)
    structural_implication: str = Field(min_length=10, max_length=1200)
    is_structurally_significant: bool
    requires_engineer_review: bool
    remediation: list[RemediationAction] = Field(min_length=1, max_length=10)
    monitoring_plan: str = Field(min_length=10, max_length=1000)
    summary: str = Field(min_length=10, max_length=1600)
    engine: EngineMeta


# --------------------------------------------------------------------------------------
# Module 3a — Real Estate Valuation
# --------------------------------------------------------------------------------------


class ValuationRequest(APIModel):
    city: str = Field(min_length=2, max_length=80)
    locality: str | None = Field(default=None, max_length=120)
    property_type: PropertyType
    super_builtup_area_sqft: float = Field(ge=100, le=1_000_000)
    carpet_area_sqft: float | None = Field(default=None, ge=50, le=1_000_000)
    age_years: float = Field(default=0, ge=0, le=120)
    floor_number: int = Field(default=0, ge=-3, le=120)
    floors_total: int = Field(default=1, ge=1, le=120)
    finish_grade: FinishGrade = FinishGrade.STANDARD
    structure_type: StructureType = StructureType.RCC_FRAME
    project_phase: ProjectPhase = ProjectPhase.COMPLETED
    parking_slots: int = Field(default=0, ge=0, le=20)
    amenities: list[str] = Field(default_factory=list, max_length=20)
    monthly_rent_estimate: float | None = Field(default=None, ge=0, le=100_000_000)
    possession_date: date | None = None

    @field_validator("amenities")
    @classmethod
    def _dedupe_amenities(cls, v: list[str]) -> list[str]:
        seen: list[str] = []
        for item in v:
            key = item.strip().lower()
            if key and key not in seen:
                seen.append(key)
        return seen

    @model_validator(mode="after")
    def _areas(self) -> "ValuationRequest":
        if self.carpet_area_sqft and self.carpet_area_sqft > self.super_builtup_area_sqft:
            raise ValueError("carpet_area_sqft cannot exceed super_builtup_area_sqft")
        if self.floor_number > self.floors_total:
            raise ValueError("floor_number cannot exceed floors_total")
        return self


class ValueDriver(APIModel):
    label: str = Field(min_length=2, max_length=120)
    impact_pct: float = Field(ge=-90, le=300, description="Signed % adjustment to the base rate")
    impact_amount: float = Field(description="Signed currency impact on total value")
    direction: Literal["positive", "negative", "neutral"]
    explanation: str = Field(min_length=5, max_length=500)


class ValuationResponse(APIModel):
    valuation_id: str
    currency: Literal["INR"]
    estimated_value: float = Field(gt=0)
    price_per_sqft: float = Field(gt=0)
    area_basis_sqft: float = Field(gt=0)
    range_low: float = Field(gt=0)
    range_high: float = Field(gt=0)
    confidence: float = Field(ge=0, le=1)
    confidence_label: Literal["low", "moderate", "high", "very_high"]
    base_rate_per_sqft: float = Field(gt=0)
    drivers: list[ValueDriver]
    comparable_note: str = Field(min_length=10, max_length=800)
    market_outlook: str = Field(min_length=10, max_length=800)
    rental_yield_pct: float | None = Field(default=None, ge=0, le=40)
    risk_flags: list[str] = Field(default_factory=list, max_length=10)
    methodology: str = Field(min_length=10, max_length=800)
    engine: EngineMeta

    @model_validator(mode="after")
    def _ranges(self) -> "ValuationResponse":
        if not (self.range_low <= self.estimated_value <= self.range_high):
            raise ValueError("estimated_value must lie inside [range_low, range_high]")
        return self


# --------------------------------------------------------------------------------------
# Module 3b — Project Planning
# --------------------------------------------------------------------------------------


class ProjectPlanRequest(APIModel):
    project_name: str = Field(min_length=3, max_length=140)
    city: str = Field(min_length=2, max_length=80)
    project_type: PropertyType
    structure_type: StructureType = StructureType.RCC_FRAME
    total_area_sqft: float = Field(
        ge=500,
        le=20_000_000,
        description="Total built-up area summed across all floors (NOT per floor).",
    )
    floors: int = Field(ge=1, le=80)
    units: int = Field(default=1, ge=1, le=5000)
    start_date: date
    target_duration_weeks: int | None = Field(default=None, ge=4, le=400)
    current_phase: ProjectPhase = ProjectPhase.PLANNING
    procurement_mode: Literal["item_rate", "epc_lump_sum", "design_build"] = "item_rate"
    site_constraints: list[str] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def _start_not_far_past(self) -> "ProjectPlanRequest":
        if self.start_date.year < 2000:
            raise ValueError("start_date must be a realistic project start (>= 2000)")
        return self


class Milestone(APIModel):
    id: str = Field(max_length=40)
    name: str = Field(min_length=3, max_length=140)
    phase: ProjectPhase
    start_date: date
    end_date: date
    duration_days: int = Field(ge=1, le=3650)
    dependencies: list[str] = Field(default_factory=list, max_length=10)
    crew_size: int = Field(ge=1, le=2000)
    key_deliverables: list[str] = Field(min_length=1, max_length=8)
    is_critical_path: bool
    weather_sensitivity: Severity
    completion_pct: int = Field(default=0, ge=0, le=100)

    @model_validator(mode="after")
    def _dates(self) -> "Milestone":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on/after start_date")
        return self


class PlannedTask(APIModel):
    name: str = Field(min_length=3, max_length=160)
    trade: Trade
    duration_days: int = Field(ge=1, le=400)
    crew: int = Field(ge=1, le=1000)
    predecessors: list[str] = Field(default_factory=list, max_length=8)
    risk_note: str = Field(min_length=5, max_length=400)


class PhaseBreakdown(APIModel):
    phase: ProjectPhase
    window_label: str = Field(max_length=80)
    weight_pct: float = Field(ge=0, le=100)
    tasks: list[PlannedTask] = Field(min_length=1, max_length=14)


class ProjectRisk(APIModel):
    id: str = Field(max_length=40)
    title: str = Field(min_length=3, max_length=160)
    category: Literal["schedule", "cost", "quality", "safety", "weather", "regulatory", "supply"]
    probability: Severity
    impact: Severity
    mitigation: str = Field(min_length=10, max_length=600)
    owner: str = Field(max_length=80)


class ResourceSummary(APIModel):
    peak_crew: int = Field(ge=1)
    total_labour_days: int = Field(ge=1)
    concrete_m3_est: float = Field(ge=0)
    steel_tonnes_est: float = Field(ge=0)
    formwork_sqm_est: float = Field(ge=0)


class ProjectPlanResponse(APIModel):
    plan_id: str
    project_name: str
    city: str
    total_duration_days: int = Field(ge=1)
    computed_start_date: date
    computed_end_date: date
    buffer_days: int = Field(ge=0)
    milestones: list[Milestone] = Field(min_length=1, max_length=60)
    phase_breakdown: list[PhaseBreakdown] = Field(min_length=1, max_length=12)
    critical_path: list[str] = Field(min_length=1)
    resources: ResourceSummary
    risks: list[ProjectRisk] = Field(min_length=1, max_length=20)
    narrative: str = Field(min_length=20, max_length=2000)
    schedule_health: Literal["on_track", "tight", "aggressive", "unrealistic"]
    engine: EngineMeta


# --------------------------------------------------------------------------------------
# Module 4a — Weather-aware advisory
# --------------------------------------------------------------------------------------


class CurrentWeather(APIModel):
    temperature_c: float = Field(ge=-50, le=60)
    feels_like_c: float = Field(ge=-60, le=70)
    humidity_pct: float = Field(ge=0, le=100)
    wind_kph: float = Field(ge=0, le=400)
    gust_kph: float = Field(ge=0, le=500)
    precipitation_mm: float = Field(ge=0, le=1000)
    precipitation_probability_pct: int = Field(ge=0, le=100)
    cloud_cover_pct: int = Field(ge=0, le=100)
    uv_index: float = Field(ge=0, le=20)
    visibility_km: float = Field(ge=0, le=100)
    condition: str = Field(max_length=80)
    is_day: bool
    observed_at: datetime


class DailyForecast(APIModel):
    day: date
    condition: str = Field(max_length=80)
    temp_max_c: float = Field(ge=-50, le=60)
    temp_min_c: float = Field(ge=-60, le=60)
    precipitation_mm: float = Field(ge=0, le=1000)
    precipitation_probability_pct: int = Field(ge=0, le=100)
    wind_max_kph: float = Field(ge=0, le=400)
    workability: PermitStatus


class AdvisoryItem(APIModel):
    id: str = Field(max_length=40)
    category: Literal["concrete", "earthwork", "steel", "masonry", "finishes", "labour_heat", "labour_cold", "wind", "lightning", "drainage", "logistics"]
    severity: Severity
    headline: str = Field(min_length=5, max_length=180)
    detail: str = Field(min_length=15, max_length=1000)
    actions: list[str] = Field(min_length=1, max_length=8)
    standard_reference: str = Field(max_length=200)


class WorkWindow(APIModel):
    label: str = Field(max_length=80)
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=0, le=23)
    suitability: PermitStatus
    reason: str = Field(min_length=5, max_length=300)


class WeatherAdvisoryResponse(APIModel):
    advisory_id: str
    location_label: str = Field(max_length=160)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    current: CurrentWeather
    forecast: list[DailyForecast] = Field(min_length=1, max_length=7)
    activity: ActivityType
    permit_status: PermitStatus
    permit_headline: str = Field(min_length=5, max_length=200)
    advisories: list[AdvisoryItem] = Field(min_length=1, max_length=14)
    work_windows: list[WorkWindow] = Field(min_length=1, max_length=6)
    heat_stress_category: Literal["normal", "caution", "extreme_caution", "danger", "extreme_danger"]
    concrete_pour_suitable: bool
    data_source: Literal["open-meteo", "simulated"]
    engine: EngineMeta


# --------------------------------------------------------------------------------------
# Module 4b — RAG knowledge assistant
# --------------------------------------------------------------------------------------


class ChatTurn(APIModel):
    role: MessageRole
    content: str = Field(min_length=1, max_length=4000)


class AssistantQuery(APIModel):
    question: str = Field(min_length=3, max_length=2000)
    # Long histories are truncated by the validator below rather than rejected: a
    # client that replays its whole transcript should still get an answer.
    history: list[ChatTurn] = Field(default_factory=list, max_length=60)
    project_context: str | None = Field(default=None, max_length=1000)
    city: str | None = Field(default=None, max_length=80)
    top_k: int = Field(default=5, ge=1, le=10)

    @field_validator("history")
    @classmethod
    def _history_window(cls, v: list[ChatTurn]) -> list[ChatTurn]:
        return v[-12:]


class Citation(APIModel):
    doc_id: str = Field(max_length=60)
    title: str = Field(max_length=200)
    section: str = Field(max_length=200)
    standard_code: str = Field(max_length=120)
    snippet: str = Field(min_length=10, max_length=900)
    relevance: float = Field(ge=0, le=1)
    source_url: str | None = Field(default=None, max_length=400)


class AssistantResponse(APIModel):
    answer: str = Field(min_length=10, max_length=6000)
    citations: list[Citation] = Field(default_factory=list, max_length=10)
    follow_ups: list[str] = Field(default_factory=list, max_length=5)
    grounded: bool = Field(description="True when the answer is supported by retrieved corpus chunks")
    low_confidence: bool
    engine: EngineMeta


# --------------------------------------------------------------------------------------
# Public registry of models (used by /api/schema endpoint + tests)
# --------------------------------------------------------------------------------------

CONTRACT_MODELS: dict[str, type[BaseModel]] = {
    "HealthResponse": HealthResponse,
    "ErrorResponse": ErrorResponse,
    "SafetyAnalysisResponse": SafetyAnalysisResponse,
    "CrackAnalysisResponse": CrackAnalysisResponse,
    "ValuationRequest": ValuationRequest,
    "ValuationResponse": ValuationResponse,
    "ProjectPlanRequest": ProjectPlanRequest,
    "ProjectPlanResponse": ProjectPlanResponse,
    "WeatherAdvisoryResponse": WeatherAdvisoryResponse,
    "AssistantQuery": AssistantQuery,
    "AssistantResponse": AssistantResponse,
}

__all__ = [
    "APIModel",
    "ActivityType",
    "AdvisoryItem",
    "AssistantQuery",
    "AssistantResponse",
    "BBox",
    "CONTRACT_MODELS",
    "ChatTurn",
    "Citation",
    "CrackAnalysisResponse",
    "CrackMeasurement",
    "CrackSeverity",
    "CrackType",
    "CurrentWeather",
    "DailyForecast",
    "EngineMeta",
    "EngineMode",
    "ErrorDetail",
    "ErrorResponse",
    "FinishGrade",
    "HealthResponse",
    "HazardCategory",
    "ImageMeta",
    "MessageRole",
    "Milestone",
    "PPEComplianceStat",
    "PPEKind",
    "PermitStatus",
    "PhaseBreakdown",
    "PlannedTask",
    "ProjectPhase",
    "ProjectPlanRequest",
    "ProjectPlanResponse",
    "ProjectRisk",
    "PropertyType",
    "RemediationAction",
    "ResourceSummary",
    "SafetyAnalysisResponse",
    "SafetyHazard",
    "Severity",
    "StructureType",
    "SurfaceType",
    "Trade",
    "ValuationRequest",
    "ValuationResponse",
    "ValueDriver",
    "WeatherAdvisoryResponse",
    "WorkWindow",
]
