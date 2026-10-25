"""
Module 4a — Weather-aware advisory & daily site assistance.

Pulls current + 7-day conditions from Open-Meteo (no API key required). If the network
is unavailable the service degrades to a deterministic, city-seeded synthetic weather
generator so the module never dead-ends. Rules encode real construction constraints:
concrete placement limits, masonry/plaster windows, earthwork after rainfall, wind
limits for lifting, lightning stand-down and heat-stress protocols.

Reference temperatures are converted to the forms used by:
  * IS 456:2000 Cl. 13.5 / ACI 305R  (hot-weather concreting)
  * ACI 306R                          (cold-weather concreting)
  * IS 10262 / IS 456                 (curing & strength gain)
  * OSHA 1926.651(h)                  (excavation & water accumulation)
  * ISO 7243 WBGT / NIOSH criteria    (heat stress at work)
"""

from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import httpx

from config import settings
from models.schemas import (
    ActivityType,
    AdvisoryItem,
    CurrentWeather,
    DailyForecast,
    EngineMode,
    PermitStatus,
    Severity,
    WeatherAdvisoryResponse,
    WorkWindow,
)
from services.common import clamp, make_engine_meta

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

WMO_CODES: dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Heavy snow showers",
    86: "Violent snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}

CITY_COORDS: dict[str, tuple[float, float, str]] = {
    "indore": (22.7196, 75.8577, "Indore, Madhya Pradesh"),
    "bhopal": (23.2599, 77.4126, "Bhopal, Madhya Pradesh"),
    "ujjain": (23.1765, 75.7885, "Ujjain, Madhya Pradesh"),
    "jabalpur": (23.1815, 79.9864, "Jabalpur, Madhya Pradesh"),
    "gwalior": (26.2183, 78.1828, "Gwalior, Madhya Pradesh"),
    "pune": (18.5204, 73.8567, "Pune, Maharashtra"),
    "mumbai": (19.0760, 72.8777, "Mumbai, Maharashtra"),
    "nagpur": (21.1458, 79.0882, "Nagpur, Maharashtra"),
    "delhi": (28.6139, 77.2090, "Delhi, NCR"),
    "new delhi": (28.6139, 77.2090, "New Delhi, NCR"),
    "gurugram": (28.4595, 77.0266, "Gurugram, Haryana"),
    "noida": (28.5355, 77.3910, "Noida, Uttar Pradesh"),
    "bengaluru": (12.9716, 77.5946, "Bengaluru, Karnataka"),
    "bangalore": (12.9716, 77.5946, "Bengaluru, Karnataka"),
    "hyderabad": (17.3850, 78.4867, "Hyderabad, Telangana"),
    "chennai": (13.0827, 80.2707, "Chennai, Tamil Nadu"),
    "kolkata": (22.5726, 88.3639, "Kolkata, West Bengal"),
    "ahmedabad": (23.0225, 72.5714, "Ahmedabad, Gujarat"),
    "surat": (21.1702, 72.8311, "Surat, Gujarat"),
    "jaipur": (26.9124, 75.7873, "Jaipur, Rajasthan"),
    "lucknow": (26.8467, 80.9462, "Lucknow, Uttar Pradesh"),
    "chandigarh": (30.7333, 76.7794, "Chandigarh"),
    "kochi": (9.9312, 76.2673, "Kochi, Kerala"),
    "coimbatore": (11.0168, 76.9558, "Coimbatore, Tamil Nadu"),
    "raipur": (21.2514, 81.6296, "Raipur, Chhattisgarh"),
}


@dataclass(slots=True)
class _WeatherBundle:
    location_label: str
    latitude: float
    longitude: float
    current: CurrentWeather
    forecast: list[DailyForecast]
    source: str


# --------------------------------------------------------------------------------------
# Retrieval
# --------------------------------------------------------------------------------------


def _resolve_location(city: str | None, lat: float | None, lon: float | None) -> tuple[float, float, str]:
    if lat is not None and lon is not None:
        return lat, lon, f"Pinned coordinates {lat:.4f}, {lon:.4f}"
    key = (city or settings.default_city).strip().lower()
    if key in CITY_COORDS:
        la, lo, label = CITY_COORDS[key]
        return la, lo, label
    return (
        settings.default_latitude,
        settings.default_longitude,
        f"{city.strip().title() if city else settings.default_city} (using regional reference coordinates)",
    )


def _fetch_open_meteo(lat: float, lon: float) -> tuple[dict, dict]:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ",".join(
            [
                "temperature_2m",
                "relative_humidity_2m",
                "apparent_temperature",
                "is_day",
                "precipitation",
                "weather_code",
                "cloud_cover",
                "wind_speed_10m",
                "wind_gusts_10m",
            ]
        ),
        "hourly": "precipitation_probability,uv_index,visibility",
        "daily": ",".join(
            [
                "weather_code",
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_sum",
                "precipitation_probability_max",
                "wind_speed_10m_max",
            ]
        ),
        "timezone": "auto",
        "forecast_days": 7,
    }
    with httpx.Client(timeout=settings.weather_timeout_seconds) as client:
        resp = client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        return resp.json(), params


def _bundle_from_open_meteo(lat: float, lon: float, label: str) -> _WeatherBundle:
    data, _ = _fetch_open_meteo(lat, lon)
    cur = data["current"]
    hourly = data.get("hourly") or {}

    now_iso = cur.get("time")
    prob = 0
    uv = 0.0
    visibility = 10.0
    if now_iso and hourly.get("time"):
        try:
            idx = hourly["time"].index(now_iso)
            prob = int((hourly.get("precipitation_probability") or [0])[idx] or 0)
            uv = float((hourly.get("uv_index") or [0])[idx] or 0)
            vis_m = float((hourly.get("visibility") or [10000])[idx] or 10000)
            visibility = round(vis_m / 1000.0, 1)
        except (ValueError, IndexError):
            pass

    current = CurrentWeather(
        temperature_c=round(float(cur["temperature_2m"]), 1),
        feels_like_c=round(float(cur["apparent_temperature"]), 1),
        humidity_pct=int(clamp(float(cur["relative_humidity_2m"]), 0, 100)),
        wind_kph=round(float(cur["wind_speed_10m"]), 1),
        gust_kph=round(float(cur.get("wind_gusts_10m") or cur["wind_speed_10m"]), 1),
        precipitation_mm=round(float(cur.get("precipitation") or 0), 2),
        precipitation_probability_pct=clamp(prob, 0, 100),
        cloud_cover_pct=int(clamp(float(cur.get("cloud_cover") or 0), 0, 100)),
        uv_index=round(clamp(uv, 0, 20), 1),
        visibility_km=clamp(visibility, 0, 100),
        condition=WMO_CODES.get(int(cur.get("weather_code") or 0), "Unknown"),
        is_day=bool(cur.get("is_day", 1)),
        observed_at=datetime.now(timezone.utc),
    )

    forecast: list[DailyForecast] = []
    daily = data["daily"]
    for i, day_str in enumerate(daily["time"][:7]):
        rain = float(daily["precipitation_sum"][i] or 0)
        wind = float(daily["wind_speed_10m_max"][i] or 0)
        forecast.append(
            DailyForecast(
                day=date.fromisoformat(day_str),
                condition=WMO_CODES.get(int(daily["weather_code"][i] or 0), "Unknown"),
                temp_max_c=round(float(daily["temperature_2m_max"][i]), 1),
                temp_min_c=round(float(daily["temperature_2m_min"][i]), 1),
                precipitation_mm=round(rain, 1),
                precipitation_probability_pct=int(clamp(float(daily["precipitation_probability_max"][i] or 0), 0, 100)),
                wind_max_kph=round(wind, 1),
                workability=_day_workability(rain, wind, float(daily["temperature_2m_max"][i]), float(daily["temperature_2m_min"][i])),
            )
        )
    return _WeatherBundle(label, lat, lon, current, forecast, "open-meteo")


def _bundle_simulated(lat: float, lon: float, label: str) -> _WeatherBundle:
    seed = int(hashlib.sha256(f"{lat:.3f}:{lon:.3f}:{date.today().isoformat()}".encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    doy = date.today().timetuple().tm_yday
    # Seasonal swing peaking near early June (doy ~ 160).
    seasonal = math.cos((doy - 160) / 365.0 * 2 * math.pi)
    mean_temp = 26.0 + 7.0 * seasonal
    temp = round(mean_temp + rng.uniform(-3.5, 4.5), 1)
    humidity = int(clamp(58 + rng.uniform(-18, 26), 15, 97))
    rain_chance = clamp(0.22 + 0.20 * max(0.0, seasonal), 0.05, 0.75)
    raining = rng.random() < rain_chance
    precip = round(rng.uniform(0.4, 14.0), 1) if raining else 0.0
    wind = round(rng.uniform(3, 22), 1)
    gust = round(wind * rng.uniform(1.3, 1.9), 1)
    cloud = int(clamp(rng.uniform(10, 95), 0, 100))
    uv = round(clamp(9.0 * max(0.1, 1 - cloud / 130) * (0.6 + 0.4 * max(0, seasonal)), 0, 13), 1)
    feels = round(temp + (2.5 if humidity > 70 else 0.0) - (1.5 if wind > 18 else 0.0), 1)
    condition = "Light rain" if raining and precip < 6 else ("Heavy rain" if raining else ("Partly cloudy" if cloud > 40 else "Clear sky"))

    current = CurrentWeather(
        temperature_c=temp,
        feels_like_c=feels,
        humidity_pct=humidity,
        wind_kph=wind,
        gust_kph=gust,
        precipitation_mm=precip,
        precipitation_probability_pct=int(min(100, rain_chance * 100 + rng.uniform(-8, 8))),
        cloud_cover_pct=cloud,
        uv_index=uv,
        visibility_km=round(clamp(12 - precip * 0.7 - (cloud / 40), 0.4, 15), 1),
        condition=condition,
        is_day=8 <= datetime.now().hour <= 18,
        observed_at=datetime.now(timezone.utc),
    )

    forecast: list[DailyForecast] = []
    for offset in range(7):
        day = date.today() + timedelta(days=offset)
        d_temp = round(temp + rng.uniform(-4, 5), 1)
        d_rain = round(rng.uniform(0, 22) if rng.random() < rain_chance else 0.0, 1)
        d_wind = round(rng.uniform(4, 30), 1)
        forecast.append(
            DailyForecast(
                day=day,
                condition="Rain showers" if d_rain > 4 else ("Overcast" if rng.random() < 0.4 else "Mainly clear"),
                temp_max_c=d_temp + rng.uniform(1, 5),
                temp_min_c=d_temp - rng.uniform(5, 10),
                precipitation_mm=d_rain,
                precipitation_probability_pct=int(clamp(rain_chance * 100 + rng.uniform(-15, 20), 0, 100)),
                wind_max_kph=d_wind,
                workability=_day_workability(d_rain, d_wind, d_temp + 3, d_temp - 7),
            )
        )
    return _WeatherBundle(label, lat, lon, current, forecast, "simulated")


def _day_workability(rain: float, wind: float, tmax: float, tmin: float) -> PermitStatus:
    if rain >= 25 or wind >= 60 or tmax >= 46 or tmin <= 2:
        return PermitStatus.HOLD
    if rain >= 6 or wind >= 40 or tmax >= 41 or tmin <= 5:
        return PermitStatus.CAUTION
    return PermitStatus.GO


def get_weather_bundle(city: str | None, lat: float | None, lon: float | None) -> tuple[_WeatherBundle, bool]:
    """Returns (bundle, degraded). `degraded` is True when the live call failed."""
    latitude, longitude, label = _resolve_location(city, lat, lon)
    if settings.weather_provider == "simulated":
        return _bundle_simulated(latitude, longitude, label), True
    try:
        return _bundle_from_open_meteo(latitude, longitude, label), False
    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        return _bundle_simulated(latitude, longitude, label), True


# --------------------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------------------


def _heat_category(feels_c: float, humidity: float) -> str:
    # Approximate WBGT from dry-bulb + humidity (Botsball-style simplification).
    wbgt = 0.7 * feels_c + 0.3 * (feels_c * 0.4 + 8) * (humidity / 100.0) + 2.0
    if wbgt >= 32:
        return "extreme_danger"
    if wbgt >= 29:
        return "danger"
    if wbgt >= 27:
        return "extreme_caution"
    if wbgt >= 24:
        return "caution"
    return "normal"


def _concrete_rules(w: CurrentWeather, activity: ActivityType) -> tuple[PermitStatus, str, list[str], str]:
    """Hot/cold/rain concrete placement rules -> (status, headline, detail bullets, standard)."""
    t = w.temperature_c
    rain = w.precipitation_mm
    prob = w.precipitation_probability_pct
    std = "IS 456:2000 Cl. 13.5 / ACI 305R / ACI 306R"

    if rain >= 8 or prob >= 75:
        return (
            PermitStatus.HOLD,
            "Concrete placement on hold — active or imminent rainfall",
            [
                f"{rain:.1f} mm of rainfall recorded with a {prob}% probability of continuation.",
                "Rain on a fresh pour alters the water-cement ratio at the surface, causing laitance, dusting and a weak top layer.",
                "Cover all recently placed concrete with tarpaulin and protect the pour surface from standing water.",
            ],
            std,
        )
    if t >= 40:
        return (
            PermitStatus.HOLD,
            "Concrete placement on hold — extreme heat",
            [
                f"Ambient at {t:.1f}°C exceeds the practical limit for placing concrete without special measures.",
                "Concrete temperature at placement must not exceed 35°C (IS 456 / ACI 305R); above this, hydration accelerates and workability collapses.",
                "If the pour is unavoidable: pre-cool aggregates, use chilled mixing water, add a retarder, and shade the delivery chute.",
                "Avoid pouring between 12:00 and 16:00 and cure immediately with wet cover or a curing compound.",
            ],
            std,
        )
    if t >= 35:
        return (
            PermitStatus.CAUTION,
            "Hot-weather concreting controls required",
            [
                f"Ambient {t:.1f}°C with {w.humidity_pct}% RH: evaporating conditions are moderate-to-high.",
                "Keep the mix temperature at or below 35°C; consider ice or chilled water in the mix.",
                "Cure within 30 minutes of finishing and maintain moist curing for 10-14 days.",
                "Prevent plastic shrinkage cracking with windbreaks and fog spray at the slab surface.",
            ],
            std,
        )
    if t <= 5:
        return (
            PermitStatus.HOLD,
            "Concrete placement on hold — cold weather",
            [
                f"Ambient {t:.1f}°C is at/below the cold-weather threshold.",
                "Concrete must be protected from freezing until it reaches 5 MPa; below 5°C hydration practically stops.",
                "Use heated mixing water/aggregates, insulated formwork and accelerators; keep records of concrete temperature at placement.",
            ],
            std,
        )
    if t <= 10:
        return (
            PermitStatus.CAUTION,
            "Cold-weather concreting — insulation and extended curing required",
            [
                f"Ambient {t:.1f}°C slows strength gain materially; stripping times must be extended.",
                "Insulate formwork and cure under cover; do not strip props early.",
            ],
            std,
        )
    if activity is ActivityType.CONCRETE_POUR:
        return (
            PermitStatus.GO,
            "Concrete placement cleared — conditions within specification",
            [
                f"Ambient {t:.1f}°C, humidity {w.humidity_pct}%, wind {w.wind_kph:.1f} km/h.",
                "Conditions are within the IS 456 hot-weather envelope; standard wet curing applies.",
            ],
            std,
        )
    return (
        PermitStatus.GO,
        "Weather within specification",
        [f"Ambient {t:.1f}°C, wind {w.wind_kph:.1f} km/h, {w.condition.lower()}."],
        std,
    )


def build_advisory(
    city: str | None,
    lat: float | None,
    lon: float | None,
    activity: ActivityType,
    request_id: str,
) -> WeatherAdvisoryResponse:
    bundle, degraded = get_weather_bundle(city, lat, lon)
    w = bundle.current
    advisories: list[AdvisoryItem] = []
    idx = 1

    def add(
        category: str,
        severity: Severity,
        headline: str,
        detail: str,
        actions: list[str],
        standard: str,
    ) -> None:
        nonlocal idx
        advisories.append(
            AdvisoryItem(
                id=f"AD-{idx:02d}",
                category=category,  # type: ignore[arg-type]
                severity=severity,
                headline=headline[:180],
                detail=detail[:1000],
                actions=actions[:8],
                standard_reference=standard[:200],
            )
        )
        idx += 1

    status, headline, concrete_bullets, concrete_std = _concrete_rules(w, activity)
    concrete_ok = status is PermitStatus.GO

    add(
        "concrete",
        Severity.CRITICAL if status is PermitStatus.HOLD else Severity.MEDIUM if status is PermitStatus.CAUTION else Severity.LOW,
        headline,
        " ".join(concrete_bullets),
        concrete_bullets,
        concrete_std,
    )

    # -- rainfall / drainage ----------------------------------------------------------
    upcoming = bundle.forecast[0] if bundle.forecast else None
    if w.precipitation_mm >= 2 or (upcoming and upcoming.precipitation_mm >= 10):
        add(
            "drainage",
            Severity.HIGH if w.precipitation_mm >= 8 else Severity.MEDIUM,
            "Rainfall response — protect excavations and stockpiles",
            (
                f"Current precipitation {w.precipitation_mm:.1f} mm; forecast today {upcoming.precipitation_mm if upcoming else 0:.1f} mm. "
                "Water accumulation in excavations softens the formation, and saturated backfill cannot be compacted to the "
                "required proctor density."
            ),
            [
                "Deploy dewatering pumps and inspect sumps before the next shift.",
                "Cover cement bags and rebar stockpiles on dunnage; keep rebar off the ground.",
                "Inspect excavation slopes and shoring for sloughing; barricade any undercut face.",
                "Suspend backfilling until the moisture content falls within the workable range.",
            ],
            "OSHA 1926.651(h) / IS 3764:1992 / IS 4701:1982",
        )

    if activity is ActivityType.EXCAVATION and w.precipitation_mm >= 4:
        add(
            "earthwork",
            Severity.HIGH,
            "Earthwork not recommended in current ground conditions",
            "Excavation and compaction become unsafe and uneconomic with standing water in the working area.",
            [
                "Re-sequence to interior finishing or MEP activities.",
                "If excavation must proceed, bench and shore to the design, with a banksman at all times.",
            ],
            "IS 3764:1992",
        )

    # -- heat stress -------------------------------------------------------------------
    heat = _heat_category(w.feels_like_c, w.humidity_pct)
    if heat in {"danger", "extreme_danger"}:
        add(
            "labour_heat",
            Severity.CRITICAL if heat == "extreme_danger" else Severity.HIGH,
            f"Heat stress category: {heat.replace('_', ' ')} — mandatory work-rest cycle",
            (
                f"Feels-like temperature is {w.feels_like_c:.1f}°C at {w.humidity_pct}% RH (approx. WBGT band '{heat}'). "
                "Unacclimatised workers lose ~1 litre/hour of sweat; core temperature above 40°C is a medical emergency."
            ),
            [
                "Enforce 15 minutes of rest per hour in a shaded, ventilated area for heavy work.",
                "Provide chilled drinking water at every work front (min. 5 litres/worker/shift) and ORS sachets.",
                "Schedule the heaviest manual tasks before 11:00 and after 16:00.",
                "Buddy-system checks for confusion, cramps or cessation of sweating — escalate immediately.",
            ],
            "ISO 7243 (WBGT) / NIOSH Criteria for a Recommended Standard: Occupational Exposure to Heat",
        )
    elif heat in {"caution", "extreme_caution"}:
        add(
            "labour_heat",
            Severity.MEDIUM if heat == "extreme_caution" else Severity.LOW,
            "Elevated heat load — hydration and shade controls",
            f"Feels-like {w.feels_like_c:.1f}°C at {w.humidity_pct}% RH. Acclimatise new workers over 5-7 days.",
            [
                "Provide shaded rest areas and drinking water within 50 m of every work front.",
                "Rotate crews on hot surfaces (rebar and formwork can exceed 60°C skin temperature).",
                "Watch for heat cramps and fatigue in the post-lunch shift.",
            ],
            "ISO 7243 (WBGT)",
        )

    if w.temperature_c <= 8:
        add(
            "labour_cold",
            Severity.MEDIUM if w.temperature_c <= 4 else Severity.LOW,
            "Cold-weather worker protection",
            f"{w.temperature_c:.1f}°C ambient with {w.wind_kph:.0f} km/h wind. Wind chill accelerates heat loss and reduces manual dexterity.",
            [
                "Issue insulated gloves and layered clothing; rotate outdoor tasks frequently.",
                "Keep a warm, dry rest area with hot drinks available.",
            ],
            "ACGIH Thermal Stress / ISO 11079",
        )

    # -- wind ---------------------------------------------------------------------------
    if w.gust_kph >= 60 or w.wind_kph >= 45:
        add(
            "wind",
            Severity.CRITICAL,
            "High wind — suspend lifting and work at height",
            (
                f"Sustained wind {w.wind_kph:.0f} km/h, gusts {w.gust_kph:.0f} km/h. Tower crane and formwork "
                "wind-load limits are typically 60-72 km/h for the crane and 40-50 km/h for climbing formwork "
                "and precast panels; sheet materials become unmanageable well below that."
            ),
            [
                "Suspend all crane lifts and place the jib in the free-slew position.",
                "Halt work at height, secure loose sheets, mesh and edge protection.",
                "Check scaffolding ties and debris netting before re-access.",
            ],
            "IS 807 / IS 3177 / OSHA 1926.1431",
        )
    elif w.wind_kph >= 30:
        add(
            "wind",
            Severity.MEDIUM,
            "Elevated wind — restrict sheet lifting and large-panel handling",
            f"Sustained wind {w.wind_kph:.0f} km/h. Large-area panels behave like sails; two-person handling is no longer adequate.",
            [
                "Use tag lines for any sheet or panel greater than 1.5 m².",
                "Avoid lifting operations above 2/3 of the crane's rated wind limit.",
            ],
            "IS 3177 / OSHA 1926.1431",
        )

    # -- lightning ----------------------------------------------------------------------
    if any("Thunderstorm" in f.condition for f in bundle.forecast[:2]) or "Thunderstorm" in w.condition:
        add(
            "lightning",
            Severity.HIGH,
            "Thunderstorm risk — lightning stand-down protocol",
            (
                "Cumulonimbus activity is forecast within 48 hours. Open structures, cranes and scaffolding "
                "create a significant lightning exposure for anyone at height."
            ),
            [
                "When thunder is heard, all work at height stops; move to a closed metal-bodied vehicle or a building.",
                "Do not shelter under scaffolding, trees or near crane masts.",
                "Wait 30 minutes after the last thunder before resuming work.",
            ],
            "IS/IEC 62305 / IS 2309",
        )

    if w.visibility_km <= 2:
        add(
            "logistics",
            Severity.MEDIUM,
            "Reduced visibility — plant movement and signal control",
            f"Visibility is down to {w.visibility_km:.1f} km. Reversing plant and crane signalling become unreliable.",
            [
                "Require a banksman for all plant movement.",
                "Move material deliveries to after the fog clears where possible.",
            ],
            "OSHA 1926.601",
        )

    if w.uv_index >= 8:
        add(
            "labour_heat",
            Severity.MEDIUM,
            "Very high UV index — direct-sun exposure",
            f"UV index is {w.uv_index:.1f}. Concrete work in direct sun also accelerates surface drying and plastic shrinkage.",
            [
                "Issue brimmed hats, long sleeves and SPF 30+ sunscreen at the gate.",
                "Cure slab surfaces immediately and use wind breaks/fog spray on exposed slabs.",
            ],
            "IS 456:2000 Cl. 13.5 / WHOniform UV guidance",
        )

    if not advisories:
        add(
            "concrete",
            Severity.LOW,
            "Clear working conditions",
            "No adverse weather drivers detected for the selected activity.",
            ["Proceed with the planned programme and keep standard controls in place."],
            "Site HSE plan",
        )

    windows = _work_windows(w)
    overall = status
    if any(a.severity is Severity.CRITICAL for a in advisories):
        overall = PermitStatus.HOLD
    elif any(a.severity is Severity.MEDIUM for a in advisories) and overall is PermitStatus.GO:
        overall = PermitStatus.CAUTION

    # Headline for the overall permit
    if overall is PermitStatus.HOLD:
        critical = next((a for a in advisories if a.severity is Severity.CRITICAL), advisories[0])
        permit_headline = f"Work restriction active: {critical.headline}"
    elif overall is PermitStatus.CAUTION:
        permit_headline = "Proceed with controls — one or more weather drivers require mitigation"
    else:
        permit_headline = "Clear to proceed — conditions are inside the specification envelope"

    worst = Severity.LOW
    for a in advisories:
        from services.common import SEVERITY_ORDER

        if SEVERITY_ORDER[a.severity] > SEVERITY_ORDER[worst]:
            worst = a.severity

    return WeatherAdvisoryResponse(
        advisory_id=request_id,
        location_label=bundle.location_label,
        latitude=bundle.latitude,
        longitude=bundle.longitude,
        current=w,
        forecast=bundle.forecast,
        activity=activity,
        permit_status=overall,
        permit_headline=permit_headline,
        advisories=advisories,
        work_windows=windows,
        heat_stress_category=heat,  # type: ignore[arg-type]
        concrete_pour_suitable=concrete_ok and status is PermitStatus.GO,
        data_source=bundle.source,  # type: ignore[arg-type]
        engine=make_engine_meta(
            mode=EngineMode.HEURISTIC,
            provider="open-meteo" if bundle.source == "open-meteo" else "weather-simulator",
            model="wx-rules-v3",
            latency_ms=0,
            confidence=0.9 if not degraded else 0.62,
            request_id=request_id,
            disclosure=(
                "Advice is generated by deterministic rule evaluation over live Open-Meteo observations "
                "and forecasts."
                if not degraded
                else "Live weather was unavailable, so city-seeded simulated conditions were used. "
                "Treat the permit status as illustrative, not site-authoritative."
            ),
        ),
    )


def _work_windows(w: CurrentWeather) -> list[WorkWindow]:
    hot = w.feels_like_c >= 35
    wet = w.precipitation_mm >= 2
    windows: list[WorkWindow] = []

    if hot:
        windows.append(
            WorkWindow(
                label="Cool window — heavy manual work",
                start_hour=6,
                end_hour=11,
                suitability=PermitStatus.GO,
                reason="Lowest radiant load and highest crew productivity.",
            )
        )
        windows.append(
            WorkWindow(
                label="Peak heat — restrict to shaded / indoor work",
                start_hour=12,
                end_hour=16,
                suitability=PermitStatus.HOLD,
                reason=f"Feels-like {w.feels_like_c:.0f}°C; risk of heat illness in direct sun.",
            )
        )
        windows.append(
            WorkWindow(
                label="Late window — resume external work",
                start_hour=16,
                end_hour=19,
                suitability=PermitStatus.CAUTION,
                reason="Temperature falling but UV and surface heat persist.",
            )
        )
    elif wet:
        windows.append(
            WorkWindow(
                label="Rain window — indoor works only",
                start_hour=6,
                end_hour=18,
                suitability=PermitStatus.HOLD,
                reason="Active rainfall; external trades and concreting exposed.",
            )
        )
        windows.append(
            WorkWindow(
                label="Post-rain inspection window",
                start_hour=18,
                end_hour=20,
                suitability=PermitStatus.CAUTION,
                reason="Check slopes, shoring and dewatering before the next shift.",
            )
        )
    else:
        windows.append(
            WorkWindow(
                label="Full shift — all trades",
                start_hour=7,
                end_hour=18,
                suitability=PermitStatus.GO,
                reason="Conditions inside specification for all planned activities.",
            )
        )
        if w.wind_kph >= 25:
            windows.append(
                WorkWindow(
                    label="Lifting window — reduced lifting after 14:00",
                    start_hour=7,
                    end_hour=14,
                    suitability=PermitStatus.CAUTION,
                    reason=f"Wind {w.wind_kph:.0f} km/h building through the afternoon.",
                )
            )
    return windows[:6]
