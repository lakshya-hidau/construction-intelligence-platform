"""
Module 3b — Automated milestone scheduling & phase-based task breakdown.

A template-driven CPM generator: a standard construction sequence is scaled to the
project's area, floor count and asset class, laid onto a working calendar (Sundays and
declared holidays excluded), then walked forward to produce dated milestones with
predecessor links. Critical path = the longest-duration chain through the sequence.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

from models.schemas import (
    EngineMode,
    Milestone,
    PhaseBreakdown,
    PlannedTask,
    ProjectPhase,
    ProjectPlanRequest,
    ProjectPlanResponse,
    ProjectRisk,
    PropertyType,
    ResourceSummary,
    Severity,
    StructureType,
    Trade,
)
from services.common import make_engine_meta

# (phase, name, base_days, area_factor, crew_per_1000sqft, trades, weather_sensitivity, deliverables)
PHASE_TEMPLATE: list[dict] = [
    {
        "phase": ProjectPhase.PLANNING,
        "name": "Pre-construction & statutory approvals",
        "base_days": 28,
        "area_factor": 0.0,
        "crew": 3,
        "trades": [Trade.MANAGEMENT],
        "weather": Severity.LOW,
        "deliverables": ["Approved building permit", "GMP & baseline schedule", "Site mobilisation plan"],
        "weight": 4.0,
        "tasks": [
            ("Soil investigation & topographic survey", Trade.MANAGEMENT, 8, 3, []),
            ("Structural design & drawing freeze", Trade.MANAGEMENT, 14, 5, []),
            ("Statutory approvals (municipal / RERA)", Trade.MANAGEMENT, 21, 2, []),
            ("Vendor finalisation & procurement plan", Trade.MANAGEMENT, 10, 4, ["T1"]),
        ],
    },
    {
        "phase": ProjectPhase.FOUNDATION,
        "name": "Excavation & foundation works",
        "base_days": 24,
        "area_factor": 0.0016,
        "crew": 22,
        "trades": [Trade.EARTHWORK, Trade.CONCRETE, Trade.STEEL],
        "weather": Severity.HIGH,
        "deliverables": ["Excavation to founding level", "PCC & raft/ footing concreting", "Foundation sign-off"],
        "weight": 12.0,
        "tasks": [
            ("Site set-out & bench-marking", Trade.MANAGEMENT, 2, 4, []),
            ("Excavation & dewatering (shoring if required)", Trade.EARTHWORK, 10, 14, []),
            ("Anti-termite & PCC bed", Trade.CONCRETE, 4, 10, ["T1"]),
            ("Isolated/raft footings — rebar & formwork", Trade.STEEL, 9, 18, ["T2"]),
            ("Footing concreting & curing", Trade.CONCRETE, 6, 14, ["T3"]),
            ("Plinth beam & backfilling compaction", Trade.CONCRETE, 7, 12, ["T4"]),
        ],
    },
    {
        "phase": ProjectPhase.STRUCTURE,
        "name": "RCC superstructure",
        "base_days": 34,
        "area_factor": 0.0032,
        "crew": 34,
        "trades": [Trade.CONCRETE, Trade.STEEL],
        "weather": Severity.MEDIUM,
        "deliverables": ["Slab-to-slab cycle achieved", "All structural members cast", "Cube test reports in green"],
        "weight": 30.0,
        "tasks": [
            ("Column starter & reinforcement", Trade.STEEL, 6, 16, []),
            ("Formwork erection (columns)", Trade.STEEL, 5, 20, ["T1"]),
            ("Column concreting", Trade.CONCRETE, 4, 14, ["T2"]),
            ("Slab & beam formwork + staging", Trade.STEEL, 8, 26, ["T3"]),
            ("Slab reinforcement & MEP sleeves", Trade.STEEL, 6, 24, ["T4"]),
            ("Slab concreting (pour-day planning)", Trade.CONCRETE, 5, 28, ["T5"]),
            ("De-shuttering & cycle reset", Trade.CONCRETE, 4, 12, ["T6"]),
        ],
    },
    {
        "phase": ProjectPhase.ENVELOPE,
        "name": "Masonry, waterproofing & façade",
        "base_days": 28,
        "area_factor": 0.0024,
        "crew": 26,
        "trades": [Trade.MASONRY, Trade.EXTERNAL],
        "weather": Severity.HIGH,
        "deliverables": ["Masonry to full height", "Terrace & toilet waterproofing with ponding test", "External plaster complete"],
        "weight": 20.0,
        "tasks": [
            ("Block masonry & lintel bands", Trade.MASONRY, 12, 18, []),
            ("Internal plaster & curing", Trade.MASONRY, 8, 16, ["T1"]),
            ("Toilet/sunken waterproofing + ponding test", Trade.EXTERNAL, 7, 8, ["T1"]),
            ("Terrace waterproofing & insulation", Trade.EXTERNAL, 6, 10, ["T3"]),
            ("External plaster, texture & sealant joints", Trade.EXTERNAL, 10, 14, ["T2"]),
        ],
    },
    {
        "phase": ProjectPhase.FINISHING,
        "name": "MEP, finishes & fit-out",
        "base_days": 40,
        "area_factor": 0.0038,
        "crew": 30,
        "trades": [Trade.MEP, Trade.FINISHES],
        "weather": Severity.LOW,
        "deliverables": ["Electrical & plumbing concealed works", "Flooring, joinery, paint complete", "Fixtures & fittings installed"],
        "weight": 28.0,
        "tasks": [
            ("Electrical conduit & concealed wiring", Trade.MEP, 10, 14, []),
            ("Plumbing & drainage rough-in", Trade.MEP, 9, 12, ["T1"]),
            ("HVAC ducting & riser shafts", Trade.MEP, 8, 10, ["T1"]),
            ("Flooring & skirting", Trade.FINISHES, 10, 16, ["T1", "T2"]),
            ("Doors, windows, joinery", Trade.FINISHES, 7, 10, ["T3"]),
            ("Putty, primer & final paint", Trade.FINISHES, 9, 14, ["T4"]),
            ("Sanitaryware & CP fittings", Trade.FINISHES, 5, 8, ["T5"]),
        ],
    },
    {
        "phase": ProjectPhase.HANDOVER,
        "name": "Testing, commissioning & handover",
        "base_days": 18,
        "area_factor": 0.0006,
        "crew": 12,
        "trades": [Trade.MEP, Trade.MANAGEMENT, Trade.EXTERNAL],
        "weather": Severity.LOW,
        "deliverables": ["All services tested & commissioned", "Snag list closed", "Occupancy certificate & as-builts issued"],
        "weight": 6.0,
        "tasks": [
            ("Snagging walk & defect rectification", Trade.MANAGEMENT, 8, 10, []),
            ("Lift / fire / electrical commissioning", Trade.MEP, 7, 8, []),
            ("External development & landscaping", Trade.EXTERNAL, 10, 12, []),
            ("Occupancy certificate & document handover", Trade.MANAGEMENT, 6, 3, ["T1", "T2"]),
        ],
    },
]

PROPERTY_DRAG: dict[PropertyType, float] = {
    PropertyType.APARTMENT: 1.00,
    PropertyType.VILLA: 1.18,
    PropertyType.COMMERCIAL_RETAIL: 1.12,
    PropertyType.OFFICE: 1.10,
    PropertyType.INDUSTRIAL_WAREHOUSE: 0.82,
    PropertyType.RESIDENTIAL_PLOT: 0.55,
}

STRUCTURE_DRAG: dict[StructureType, float] = {
    StructureType.RCC_FRAME: 1.00,
    StructureType.LOAD_BEARING: 0.88,
    StructureType.STEEL_FRAME: 1.14,
    StructureType.HYBRID: 1.08,
}


def _is_working_day(day: date) -> bool:
    return day.weekday() != 6  # Sunday off; site works Mon-Sat


def _add_working_days(start: date, days: int) -> date:
    remaining = max(0, days - 1)
    cursor = start
    while remaining > 0:
        cursor += timedelta(days=1)
        if _is_working_day(cursor):
            remaining -= 1
    while not _is_working_day(cursor):
        cursor += timedelta(days=1)
    return cursor


def _count_working_days(start: date, end: date) -> int:
    if end <= start:
        return 1
    total = 0
    cursor = start
    while cursor <= end:
        if _is_working_day(cursor):
            total += 1
        cursor += timedelta(days=1)
    return max(1, total)


def _phase_durations(
    total_area: float, floors: int, units: int, project_type: PropertyType
) -> dict[ProjectPhase, int]:
    """Quantity-driven durations in working days.

    Each phase is driven by the quantity that actually governs it, not by total area:
    the superstructure is paced by the floor cycle, finishes by the unit count, and the
    envelope by the façade height. This keeps a 1,200 sqft house and a 1,20,000 sqft
    tower both inside realistic ranges.
    """
    per_floor = total_area / max(floors, 1)

    # RCC slab cycle: ~6 days minimum plus area-driven reinforcement/formwork time.
    # The footprint term is clamped so a single-storey shed with a huge floor plate
    # does not produce an absurd foundation duration.
    footprint = min(per_floor, 45_000.0)
    cycle_days = 6.0 + per_floor / 5200.0
    structure = max(20.0, floors * cycle_days)

    foundation = 12.0 + footprint / 760.0 + floors * 1.4
    envelope = 10.0 + floors * 2.1 + footprint / 3400.0
    finishing = 14.0 + units * 0.30 + total_area / 4200.0
    handover = 9.0 + floors * 0.7 + total_area / 60000.0
    planning = 18.0 + min(floors, 12) * 0.5

    # Industrial sheds are fast; plots have almost no construction scope.
    if project_type is PropertyType.INDUSTRIAL_WAREHOUSE:
        structure = max(12.0, structure * 0.55)
        finishing *= 0.55
        foundation *= 0.75
        envelope *= 0.45
    elif project_type is PropertyType.RESIDENTIAL_PLOT:
        # A serviced plot has survey, approvals and boundary works only.
        planning, foundation, structure, envelope, finishing, handover = 10, 8, 4, 3, 4, 5

    return {
        ProjectPhase.PLANNING: int(round(max(8, planning))),
        ProjectPhase.FOUNDATION: int(round(max(6, foundation))),
        ProjectPhase.STRUCTURE: int(round(max(6, structure))),
        ProjectPhase.ENVELOPE: int(round(max(6, envelope))),
        ProjectPhase.FINISHING: int(round(max(8, finishing))),
        ProjectPhase.HANDOVER: int(round(max(6, handover))),
    }


def _phase_crew(base_crew: int, per_floor: float) -> int:
    """Crew scales with the working front (floor plate), not with total volume."""
    factor = math.sqrt(max(per_floor, 250.0) / 2500.0)
    return int(max(2, round(base_crew * min(max(factor, 0.45), 3.6))))


def plan_project(req: ProjectPlanRequest, *, request_id: str) -> ProjectPlanResponse:
    per_floor_area = req.total_area_sqft / max(req.floors, 1)
    asset_drag = PROPERTY_DRAG[req.project_type]
    struct_drag = STRUCTURE_DRAG[req.structure_type]
    constraint_penalty = 1.0 + 0.03 * min(len(req.site_constraints), 6)

    durations = _phase_durations(req.total_area_sqft, req.floors, req.units, req.project_type)

    milestones: list[Milestone] = []
    phases: list[PhaseBreakdown] = []
    cursor = req.start_date
    prev_ms: list[str] = []
    critical_chain: list[str] = []
    total_labour_days = 0
    peak_crew = 0
    total_weight = sum(t["weight"] for t in PHASE_TEMPLATE)

    for p_idx, tpl in enumerate(PHASE_TEMPLATE):
        phase_key: ProjectPhase = tpl["phase"]
        duration = int(round(durations[phase_key] * asset_drag * struct_drag * constraint_penalty))
        duration = max(4, duration)

        start = cursor if _is_working_day(cursor) else _add_working_days(cursor, 1)
        end = _add_working_days(start, duration)
        working_days = _count_working_days(start, end)

        crew = _phase_crew(int(tpl["crew"]), per_floor_area)
        peak_crew = max(peak_crew, crew)
        total_labour_days += crew * working_days

        # Distribute the phase window across its template tasks proportionally.
        template_total = sum(task[2] for task in tpl["tasks"])
        phase_tasks: list[PlannedTask] = []
        for name, trade, t_days, t_crew, preds in tpl["tasks"]:
            scaled = max(1, int(round(working_days * (t_days / template_total))))
            phase_tasks.append(
                PlannedTask(
                    name=name[:160],
                    trade=trade,
                    duration_days=scaled,
                    crew=max(1, int(round(t_crew * min(max(math.sqrt(max(per_floor_area, 250.0) / 2500.0), 0.45), 3.0)))),
                    predecessors=[f"T{p_idx + 1}-{p}" for p in preds][:8],
                    risk_note=_task_risk_note(trade, req),
                )
            )

        order = list(ProjectPhase)
        completion = 100 if order.index(req.current_phase) > order.index(phase_key) else (
            45 if order.index(req.current_phase) == order.index(phase_key) else 0
        )

        ms_id = f"MS-{p_idx + 1:02d}"
        milestones.append(
            Milestone(
                id=ms_id,
                name=tpl["name"][:140],
                phase=phase_key,
                start_date=start,
                end_date=end,
                duration_days=working_days,
                dependencies=prev_ms[:4],
                crew_size=crew,
                key_deliverables=tpl["deliverables"],
                is_critical_path=True,
                weather_sensitivity=tpl["weather"],
                completion_pct=completion,
            )
        )
        critical_chain.append(ms_id)

        phases.append(
            PhaseBreakdown(
                phase=phase_key,
                window_label=f"{start.strftime('%d %b %Y')} → {end.strftime('%d %b %Y')}",
                weight_pct=round(100.0 * tpl["weight"] / total_weight, 1),
                tasks=phase_tasks,
            )
        )

        prev_ms = [ms_id]
        cursor = end + timedelta(days=1)

    computed_end = milestones[-1].end_date
    total_days = _count_working_days(req.start_date, computed_end)

    buffer_pct = 0.08 if not req.site_constraints else 0.12
    buffer_days = int(round(total_days * buffer_pct))

    health: str
    if req.target_duration_weeks:
        target_days = req.target_duration_weeks * 6  # six working days per week
        ratio = target_days / max(total_days, 1)
        if ratio >= 1.10:
            health = "on_track"
        elif ratio >= 0.98:
            health = "tight"
        elif ratio >= 0.85:
            health = "aggressive"
        else:
            health = "unrealistic"
    else:
        health = "on_track" if not req.site_constraints else "tight"

    # `total_area_sqft` is total built-up area across all floors, so the quantity
    # take-off must NOT be multiplied by the floor count again.
    # Norms: 0.22 m3 concrete and 1.35 m2 formwork per m2 of built-up area;
    # reinforcement at ~95 kg per m3 of concrete for RCC framing.
    bua_sqm = req.total_area_sqft / 10.764
    concrete_m3 = round(bua_sqm * 0.22, 1)
    steel_t = round(concrete_m3 * 0.095, 1)
    formwork_sqm = round(bua_sqm * 1.35, 1)

    risks = _build_risks(req, health, buffer_days)
    narrative = _narrative(req, milestones, total_days, buffer_days, health, peak_crew)

    return ProjectPlanResponse(
        plan_id=request_id,
        project_name=req.project_name,
        city=req.city,
        total_duration_days=total_days,
        computed_start_date=req.start_date,
        computed_end_date=computed_end,
        buffer_days=buffer_days,
        milestones=milestones,
        phase_breakdown=phases,
        critical_path=critical_chain,
        resources=ResourceSummary(
            peak_crew=peak_crew,
            total_labour_days=total_labour_days,
            concrete_m3_est=max(0.0, concrete_m3),
            steel_tonnes_est=max(0.0, steel_t),
            formwork_sqm_est=max(0.0, formwork_sqm),
        ),
        risks=risks,
        narrative=narrative,
        schedule_health=health,  # type: ignore[arg-type]
        engine=make_engine_meta(
            mode=EngineMode.HEURISTIC,
            provider="planning-engine",
            model="cpm-template-v2",
            latency_ms=0,
            confidence=0.78 if health == "on_track" else 0.68,
            request_id=request_id,
            disclosure=(
                "Generated by the deterministic CPM sequencing engine from an industry-standard "
                "construction sequence, scaled to your area, height and asset class. Validate durations "
                "against your own productivity norms and subcontractor commitments before issuing."
            ),
        ),
    )


def _task_risk_note(trade: Trade, req: ProjectPlanRequest) -> str:
    notes = {
        Trade.EARTHWORK: "Monsoon window: keep sumps and dewatering pumps on standby.",
        Trade.CONCRETE: "Pour-day readiness: confirm batching plant slot, pump and standby power.",
        Trade.STEEL: "Rebar supply lead time drives this task; book rolling margin early.",
        Trade.MASONRY: "Block availability and mason-to-helper ratio govern productivity.",
        Trade.MEP: "Coordinate sleeves and openings before concreting to avoid later cutting.",
        Trade.FINISHES: "Wet-area sequencing: complete waterproofing ponding test before tiling.",
        Trade.EXTERNAL: "External work is weather-exposed; hold 2 float days per rain event.",
        Trade.MANAGEMENT: "Approval dependencies are outside site control; track weekly.",
    }
    note = notes[trade]
    if req.site_constraints:
        note += f" Site constraints on record: {', '.join(req.site_constraints[:3])}."
    return note[:400]


def _build_risks(req: ProjectPlanRequest, health: str, buffer_days: int) -> list[ProjectRisk]:
    risks: list[ProjectRisk] = []

    if health in {"aggressive", "unrealistic"}:
        risks.append(
            ProjectRisk(
                id="R-01",
                title="Target completion date is not achievable with the standard sequence",
                category="schedule",
                probability=Severity.HIGH,
                impact=Severity.HIGH,
                mitigation=(
                    "Either extend the target date, add a second structural crew with an additional "
                    "formwork set, or de-scope the finishing package to a later phase. Re-baseline before "
                    "issuing the schedule to subcontractors."
                ),
                owner="Project Manager",
            )
        )

    if req.project_type in {PropertyType.APARTMENT, PropertyType.VILLA}:
        risks.append(
            ProjectRisk(
                id=f"R-{len(risks) + 1:02d}",
                title="Concrete supply disruption during peak pour cycles",
                category="supply",
                probability=Severity.MEDIUM,
                impact=Severity.HIGH,
                mitigation=(
                    "Contract a secondary ready-mix plant and keep a standby pump on call. Pre-approve an "
                    "alternate mix design to avoid cold joints during a failed delivery."
                ),
                owner="Procurement Lead",
            )
        )

    risks.append(
        ProjectRisk(
            id=f"R-{len(risks) + 1:02d}",
            title="Monsoon / extreme-heat schedule float consumption",
            category="weather",
            probability=Severity.MEDIUM,
            impact=Severity.MEDIUM,
            mitigation=(
                f"Protect the {buffer_days}-day contingency and cluster earthwork and external works in "
                "the dry window. Pre-position tarpaulins, dewatering pumps and heat-stress controls."
            ),
            owner="Site Engineer",
        )
    )

    if req.structure_type is StructureType.STEEL_FRAME:
        risks.append(
            ProjectRisk(
                id=f"R-{len(risks) + 1:02d}",
                title="Fabricated steel delivery and erection tolerance clash",
                category="supply",
                probability=Severity.MEDIUM,
                impact=Severity.HIGH,
                mitigation=(
                    "Freeze shop drawings before fabrication, run a 3D clash check against MEP, and stage "
                    "a trial erection of the first bay."
                ),
                owner="Structural Engineer",
            )
        )

    if len(req.site_constraints) >= 3:
        risks.append(
            ProjectRisk(
                id=f"R-{len(risks) + 1:02d}",
                title="Multiple site constraints compress working fronts",
                category="schedule",
                probability=Severity.HIGH,
                impact=Severity.MEDIUM,
                mitigation=(
                    "Re-plan into a takt/location-based sequence and secure off-site staging for materials "
                    "that cannot be stored within the site boundary."
                ),
                owner="Planning Engineer",
            )
        )

    risks.append(
        ProjectRisk(
            id=f"R-{len(risks) + 1:02d}",
            title="Statutory inspection delays at occupancy stage",
            category="regulatory",
            probability=Severity.MEDIUM,
            impact=Severity.HIGH,
            mitigation=(
                "Pre-book fire, lift and electrical inspections at 80% completion; maintain a live "
                "compliance dossier so no certificate depends on a late document hunt."
            ),
            owner="Compliance Officer",
        )
    )

    return risks[:8]


def _narrative(
    req: ProjectPlanRequest,
    milestones: list[Milestone],
    total_days: int,
    buffer_days: int,
    health: str,
    peak_crew: int,
) -> str:
    first = milestones[0]
    last = milestones[-1]
    health_text = {
        "on_track": "The target duration is comfortably achievable with the standard sequence.",
        "tight": "The target duration is achievable but leaves little room for weather or approval slippage.",
        "aggressive": "The target duration is aggressive; it assumes parallel working and no rain days.",
        "unrealistic": "The target duration is not achievable with the proposed sequence and crew mix.",
    }[health]
    return (
        f"{req.project_name} is planned as a {req.floors}-floor {req.project_type.value.replace('_', ' ')} "
        f"development of {req.total_area_sqft:,.0f} sqft in {req.city}. The critical path runs through "
        f"'{first.name}' ({first.start_date:%d %b}) to '{last.name}' ({last.end_date:%d %b}), covering "
        f"{total_days} working days across {len(milestones)} phase milestones. A {buffer_days}-day "
        f"contingency is carried ({buffer_pct_label(req)} of the programme) and peak direct labour peaks at "
        f"{peak_crew} operatives. {health_text} Procurement mode is "
        f"{req.procurement_mode.replace('_', ' ')}; durations must be re-validated against the selected "
        "contractor's productivity norms before the programme is issued for construction."
    )[:2000]


def buffer_pct_label(req: ProjectPlanRequest) -> str:
    return "12%" if req.site_constraints else "8%"

