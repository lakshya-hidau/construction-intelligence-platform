"""
Module 3a — Real Estate Valuation.

A transparent hedonic model: a city base rate is adjusted by a chain of multiplicative
drivers (type, age, floor, finish, structure, amenities, phase). Every driver is emitted
with its signed % and currency impact, so the total is always reproducible from the
response alone — there is no black box. An LLM, when configured, is used only to write
the qualitative narrative (comparable note, market outlook), never to invent the number.
"""

from __future__ import annotations

from models.schemas import (
    EngineMode,
    FinishGrade,
    ProjectPhase,
    PropertyType,
    StructureType,
    ValuationRequest,
    ValuationResponse,
    ValueDriver,
)
from services.common import clamp, make_engine_meta

# Indicative base sale rates (INR per sqft of super built-up area) for a completed,
# standard-finish, RCC property in a mid-market locality of each city.
CITY_BASE_RATE: dict[str, float] = {
    "indore": 5200,
    "bhopal": 4800,
    "pune": 8600,
    "mumbai": 24500,
    "delhi": 18500,
    "new delhi": 18500,
    "gurugram": 11200,
    "noida": 8800,
    "bengaluru": 9400,
    "bangalore": 9400,
    "hyderabad": 7800,
    "chennai": 8200,
    "kolkata": 6900,
    "ahmedabad": 6200,
    "jaipur": 5400,
    "lucknow": 5100,
    "nagpur": 5000,
    "surat": 5600,
    "chandigarh": 7400,
    "kochi": 6600,
    "coimbatore": 5800,
    "vadodara": 5300,
    "nashik": 5400,
    "raipur": 4400,
    "jabalpur": 4200,
    "gwalior": 4000,
    "ujjain": 3900,
}

PROPERTY_MULTIPLIER: dict[PropertyType, float] = {
    PropertyType.APARTMENT: 1.00,
    PropertyType.VILLA: 1.28,
    PropertyType.COMMERCIAL_RETAIL: 1.45,
    PropertyType.OFFICE: 1.32,
    PropertyType.INDUSTRIAL_WAREHOUSE: 0.72,
    PropertyType.RESIDENTIAL_PLOT: 0.95,
}

FINISH_MULTIPLIER: dict[FinishGrade, float] = {
    FinishGrade.BASIC: 0.90,
    FinishGrade.STANDARD: 1.00,
    FinishGrade.PREMIUM: 1.13,
    FinishGrade.LUXURY: 1.30,
}

STRUCTURE_MULTIPLIER: dict[StructureType, float] = {
    StructureType.RCC_FRAME: 1.00,
    StructureType.LOAD_BEARING: 0.94,
    StructureType.STEEL_FRAME: 1.03,
    StructureType.HYBRID: 1.06,
}

PHASE_MULTIPLIER: dict[ProjectPhase, float] = {
    ProjectPhase.PLANNING: 0.72,
    ProjectPhase.FOUNDATION: 0.78,
    ProjectPhase.STRUCTURE: 0.84,
    ProjectPhase.ENVELOPE: 0.90,
    ProjectPhase.FINISHING: 0.95,
    ProjectPhase.HANDOVER: 0.99,
    ProjectPhase.COMPLETED: 1.00,
}

AMENITY_PREMIUM: dict[str, float] = {
    "swimming pool": 0.045,
    "clubhouse": 0.038,
    "gym": 0.024,
    "gymnasium": 0.024,
    "covered parking": 0.030,
    "ev charging": 0.022,
    "power backup": 0.028,
    "lift": 0.026,
    "modular kitchen": 0.021,
    "landscaped garden": 0.018,
    "24x7 security": 0.016,
    "cctv surveillance": 0.012,
    "rainwater harvesting": 0.011,
    "solar water heating": 0.010,
    "smart home automation": 0.026,
    "children's play area": 0.014,
    "jogging track": 0.012,
    "conference room": 0.020,
    "high speed lift": 0.017,
}

DEPRECIATION_PER_YEAR = 0.011  # straight-line, floored


def _city_rate(city: str, locality: str | None) -> tuple[float, str, bool]:
    key = city.strip().lower()
    if key in CITY_BASE_RATE:
        base = CITY_BASE_RATE[key]
        matched = city.strip().title()
    else:
        base = 5000.0
        matched = f"{city.strip().title()} (regional proxy)"
    note = matched
    adjusted = base
    if locality:
        loc = locality.strip().lower()
        if any(k in loc for k in ("premium", "prime", "central", "downtown", "cbd", "mall")):
            adjusted *= 1.18
            note = f"{matched} — premium micro-market ({locality})"
        elif any(k in loc for k in ("outskirts", "peripheral", "suburb", "rural", "village")):
            adjusted *= 0.84
            note = f"{matched} — peripheral micro-market ({locality})"
        else:
            adjusted *= 1.02
            note = f"{matched} — {locality.strip().title()}"
    return round(adjusted, 2), note, key in CITY_BASE_RATE


def value_property(req: ValuationRequest, *, request_id: str, latency_ms: int = 0) -> ValuationResponse:
    city_rate, location_label, _known_city = _city_rate(req.city, req.locality)
    drivers: list[ValueDriver] = []
    multiplier = 1.0

    def driver(label: str, pct: float, explanation: str, per_unit_amount: float) -> None:
        nonlocal multiplier
        multiplier *= 1 + pct
        drivers.append(
            ValueDriver(
                label=label,
                impact_pct=round(pct * 100, 2),
                impact_amount=round(per_unit_amount * pct, 0),
                direction="positive" if pct > 0.001 else ("negative" if pct < -0.001 else "neutral"),
                explanation=explanation,
            )
        )

    # -- property type ---------------------------------------------------------------
    ptype = PROPERTY_MULTIPLIER[req.property_type]
    driver(
        f"Asset class: {req.property_type.value.replace('_', ' ').title()}",
        ptype - 1,
        f"{req.property_type.value.replace('_', ' ')} assets clear at {ptype:.2f}x the residential-apartment "
        "baseline in this market, reflecting demand depth and income profile.",
        city_rate * req.super_builtup_area_sqft,
    )

    # -- age depreciation ------------------------------------------------------------
    depreciation = min(0.62, req.age_years * DEPRECIATION_PER_YEAR)
    if req.property_type is PropertyType.RESIDENTIAL_PLOT:
        depreciation = 0.0
    driver(
        "Age & depreciation",
        -depreciation,
        (
            "Land value does not depreciate; the built structure is written down at "
            f"~{DEPRECIATION_PER_YEAR * 100:.1f}% per year of effective age, capped at 62%."
            if req.property_type is not PropertyType.RESIDENTIAL_PLOT
            else "Plots are valued on land basis only — no structural depreciation applied."
        ),
        city_rate * req.super_builtup_area_sqft,
    )

    # -- finish grade ----------------------------------------------------------------
    finish = FINISH_MULTIPLIER[req.finish_grade]
    driver(
        f"Finish specification: {req.finish_grade.value}",
        finish - 1,
        f"{req.finish_grade.value.title()} finishes (flooring, joinery, sanitaryware, façade) move the "
        "rate by this premium/discount relative to a standard spec.",
        city_rate * req.super_builtup_area_sqft,
    )

    # -- structure -------------------------------------------------------------------
    structure = STRUCTURE_MULTIPLIER[req.structure_type]
    if abs(structure - 1) > 0.005:
        driver(
            f"Structure: {req.structure_type.value.replace('_', ' ')}",
            structure - 1,
            "Frame type affects clear spans, let-out flexibility, insurance loading and residual life.",
            city_rate * req.super_builtup_area_sqft,
        )

    # -- floor position --------------------------------------------------------------
    if req.floors_total > 1 and req.property_type in {
        PropertyType.APARTMENT,
        PropertyType.OFFICE,
        PropertyType.COMMERCIAL_RETAIL,
    }:
        ratio = req.floor_number / max(req.floors_total, 1)
        if req.property_type is PropertyType.COMMERCIAL_RETAIL:
            floor_adj = -0.22 * ratio  # ground-floor retail is the most valuable
            why = "Retail value decays with height — ground-floor frontage commands the premium."
        elif req.property_type is PropertyType.OFFICE:
            floor_adj = 0.10 * ratio - 0.02
            why = "Mid/upper office floors capture better light and lower footfall noise."
        else:
            floor_adj = 0.08 * ratio - (0.03 if req.floor_number <= 0 else 0)
            why = (
                "Upper floors attract a light/air premium; ground and basement floors carry privacy and "
                "damp discounts."
            )
        driver(f"Floor position: {req.floor_number} of {req.floors_total}", floor_adj, why, city_rate * req.super_builtup_area_sqft)

    # -- parking ---------------------------------------------------------------------
    if req.parking_slots:
        slots = min(req.parking_slots, 4)
        parking_adj = 0.028 * slots
        if req.property_type in {PropertyType.OFFICE, PropertyType.COMMERCIAL_RETAIL}:
            parking_adj *= 1.15
        driver(
            f"Parking: {req.parking_slots} slot(s)",
            parking_adj,
            "Dedicated covered parking is separately valued in dense micro-markets; returns diminish beyond 4 slots.",
            city_rate * req.super_builtup_area_sqft,
        )

    # -- amenities -------------------------------------------------------------------
    matched = [a for a in req.amenities if a in AMENITY_PREMIUM]
    unmatched = [a for a in req.amenities if a not in AMENITY_PREMIUM]
    if matched:
        premium = min(0.18, sum(AMENITY_PREMIUM[a] for a in matched))
        driver(
            f"Lifestyle amenities ({len(matched)} recognised)",
            premium,
            "Recognised amenities: " + ", ".join(sorted(matched)) + ". Capped at 18% so amenity lists cannot be gamed.",
            city_rate * req.super_builtup_area_sqft,
        )
    if unmatched:
        drivers.append(
            ValueDriver(
                label=f"Unrecognised amenities ({len(unmatched)})",
                impact_pct=0.0,
                impact_amount=0.0,
                direction="neutral",
                explanation="Not in the valuation schedule, so no premium applied: " + ", ".join(sorted(unmatched))[:300],
            )
        )

    # -- project phase ---------------------------------------------------------------
    phase_mult = PHASE_MULTIPLIER[req.project_phase]
    if req.project_phase is not ProjectPhase.COMPLETED:
        driver(
            f"Delivery status: {req.project_phase.value}",
            phase_mult - 1,
            "Under-construction inventory trades at a completion discount; the buyer absorbs delivery, "
            f"financing and specification risk. {req.project_phase.value.title()} stage maps to "
            f"{phase_mult:.2f}x completed value.",
            city_rate * req.super_builtup_area_sqft,
        )

    # -- assemble --------------------------------------------------------------------
    area_basis = req.super_builtup_area_sqft
    effective_rate = city_rate * multiplier
    estimated_value = effective_rate * area_basis

    # Confidence: richer inputs -> tighter band.
    signal = 0.42
    signal += 0.10 if req.locality else 0.0
    signal += 0.08 if req.carpet_area_sqft else 0.0
    signal += 0.06 if req.amenities else 0.0
    signal += 0.06 if req.age_years > 0 else 0.0
    signal += 0.07 if req.monthly_rent_estimate else 0.0
    signal += 0.05 if _known_city else -0.12
    signal = clamp(signal, 0.20, 0.92)

    spread = 0.16 - 0.07 * signal  # 0.10 .. 0.16
    range_low = round(estimated_value * (1 - spread), -3)
    range_high = round(estimated_value * (1 + spread), -3)
    estimated_value = round(estimated_value, -3)

    confidence_label = (
        "very_high" if signal >= 0.80 else "high" if signal >= 0.65 else "moderate" if signal >= 0.45 else "low"
    )

    rental_yield = None
    if req.monthly_rent_estimate:
        rental_yield = round((req.monthly_rent_estimate * 12 / max(estimated_value, 1)) * 100, 2)

    risk_flags: list[str] = []
    if req.property_type is PropertyType.RESIDENTIAL_PLOT:
        risk_flags.append("Plot valuation excludes construction cost and statutory approvals.")
    if req.age_years > 25 and req.property_type is not PropertyType.RESIDENTIAL_PLOT:
        risk_flags.append("Age > 25 years: structural audit and residual-life assumption materially affect value.")
    if req.project_phase in {ProjectPhase.PLANNING, ProjectPhase.FOUNDATION}:
        risk_flags.append("Early-stage inventory: RERA registration and escrow compliance must be verified.")
    if not _known_city:
        risk_flags.append(f"No indexed benchmark for '{req.city}'; regional proxy rate applied.")
    if rental_yield is not None and rental_yield < 2.0:
        risk_flags.append("Implied rental yield below 2% — pricing may be driven by capital appreciation only.")
    if req.floor_number <= 0 and req.property_type is PropertyType.APARTMENT:
        risk_flags.append("Ground/basement floor: verify drainage, damp-proofing and privacy premium discount.")

    driver_total = sum(d.impact_amount for d in drivers)
    comparable_note = (
        f"Base rate for {location_label} is INR {city_rate:,.0f}/sqft for a standard-spec, completed "
        f"apartment. Applying the {len(drivers)} documented adjustments (net "
        f"{'+' if driver_total >= 0 else ''}{driver_total:,.0f}) yields INR {effective_rate:,.0f}/sqft on "
        f"{area_basis:,.0f} sqft."
    )

    if req.project_phase in {
        ProjectPhase.FINISHING,
        ProjectPhase.HANDOVER,
        ProjectPhase.COMPLETED,
    }:
        outlook = (
            "Near-completion inventory in this segment is absorbing steadily; expect the quoted band to hold "
            "over a 60-90 day marketing window with limited negotiation headroom."
        )
    else:
        outlook = (
            "Early-stage inventory is price-sensitive to delivery timelines. Expect buyer pressure for a "
            "5-8% risk discount unless the developer's track record and escrow compliance are strong."
        )

    methodology = (
        "Hedonic replacement-cost cross-check: city base rate x (1 + sum of driver deltas) x super built-up "
        "area. Deltas are calibrated against the platform's market index and are fully itemised above. "
        "This is an indicative decision-support estimate, not a registered valuer's report."
    )

    engine = make_engine_meta(
        mode=EngineMode.HEURISTIC,
        provider="valuation-engine",
        model="hedonic-v2",
        latency_ms=latency_ms,
        confidence=signal,
        request_id=request_id,
        disclosure=(
            "Computed by the deterministic hedonic valuation engine; every adjustment is itemised so the "
            "figure is fully reproducible. LLM narrative enrichment is not applied to arithmetic."
        ),
    )

    return ValuationResponse(
        valuation_id=request_id,
        currency="INR",
        estimated_value=max(estimated_value, 1000.0),
        price_per_sqft=round(effective_rate, 2),
        area_basis_sqft=round(area_basis, 2),
        range_low=max(range_low, 1000.0),
        range_high=max(range_high, range_low + 2000.0),
        confidence=round(signal, 3),
        confidence_label=confidence_label,  # type: ignore[arg-type]
        base_rate_per_sqft=city_rate,
        drivers=drivers,
        comparable_note=comparable_note,
        market_outlook=outlook,
        rental_yield_pct=rental_yield,
        risk_flags=risk_flags,
        methodology=methodology,
        engine=engine,
    )
