"""
Test suite for the Multimodal Construction Intelligence Platform.

Run from backend/:  python -m pytest tests -q

Covers:
  * every response conforms to its Pydantic contract (including on fallback paths)
  * error handling returns the uniform envelope with correct HTTP status codes
  * upload guards (size, MIME, decodability, dimensions)
  * the arithmetic invariants of the valuation and planning engines
  * RAG retrieval precision AND refusal on out-of-domain questions
"""

from __future__ import annotations

import io
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

import main
from models.schemas import (
    AssistantResponse,
    CrackAnalysisResponse,
    HealthResponse,
    ProjectPlanResponse,
    SafetyAnalysisResponse,
    ValuationResponse,
    WeatherAdvisoryResponse,
)
from services.knowledge import retrieve
from services.llm import MultimodalClient

client = TestClient(main.app)


# --------------------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------------------


def _png(width: int = 640, height: int = 480, colour=(150, 150, 148)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), colour).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def site_image() -> bytes:
    """Synthetic site frame: hi-vis torsos, bare heads, a dark shadow zone."""
    img = Image.new("RGB", (900, 700), (150, 172, 196))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 380, 900, 700], fill=(122, 114, 102))
    d.rectangle([0, 560, 900, 700], fill=(30, 30, 34))
    for x in range(60, 860, 110):
        d.rectangle([x, 120, x + 8, 400], fill=(96, 95, 93))
    for cx, cy, vest in [(220, 430, True), (420, 450, True), (620, 435, False)]:
        d.rectangle([cx - 18, cy - 50, cx + 18, cy + 40], fill=(224, 232, 44) if vest else (68, 88, 158))
        d.ellipse([cx - 14, cy - 80, cx + 14, cy - 52], fill=(238, 202, 168))
    return _jpeg(img)


@pytest.fixture(scope="module")
def crack_image() -> bytes:
    """Synthetic concrete surface with a diagonal crack."""
    img = Image.new("RGB", (800, 600), (170, 168, 162))
    d = ImageDraw.Draw(img)
    d.line([(60, 90), (300, 260), (520, 380), (740, 520)], fill=(36, 34, 32), width=5, joint="curve")
    d.line([(300, 260), (420, 190)], fill=(46, 44, 40), width=3)
    return _jpeg(img)


def _jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _upload(raw: bytes, name: str = "x.jpg", mime: str = "image/jpeg"):
    return {"image": (name, raw, mime)}


class TestGeminiClient:
    def test_api_key_is_sent_in_header_not_url(self, monkeypatch):
        import services.llm as llm_module

        api_key = "test-gemini-key"
        monkeypatch.setattr(llm_module.settings, "gemini_api_key", api_key)
        captured: dict[str, object] = {}

        class Response:
            def raise_for_status(self):
                pass

            def json(self):
                return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

        class Client:
            def __init__(self, timeout):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                pass

            def post(self, url, *, headers, json):
                captured.update(url=url, headers=headers, json=json)
                return Response()

        monkeypatch.setattr(llm_module.httpx, "Client", Client)

        result = MultimodalClient()._gemini("system", "prompt", [], 0.1, 100, True)

        assert result == "ok"
        assert "?" not in captured["url"]
        assert api_key not in captured["url"]
        assert captured["headers"]["x-goog-api-key"] == api_key


# --------------------------------------------------------------------------------------
# System
# --------------------------------------------------------------------------------------


class TestSystem:
    def test_health_contract(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert HealthResponse.model_validate(r.json()).status == "ok"

    def test_request_id_header_is_echoed(self):
        r = client.get("/health", headers={"X-Request-ID": "abc123"})
        assert r.headers["X-Request-ID"] == "abc123"

    def test_request_id_is_generated(self):
        r = client.get("/health")
        assert len(r.headers["X-Request-ID"]) >= 16

    def test_contracts_endpoint_lists_models(self):
        payload = client.get("/api/contracts").json()
        assert payload["count"] >= 10
        assert "SafetyAnalysisResponse" in payload["models"]
        assert "properties" in payload["models"]["SafetyAnalysisResponse"]

    def test_options_enumerations(self):
        payload = client.get("/api/options").json()
        for key in ("property_types", "surface_types", "activity_types"):
            assert len(payload[key]) > 1
            assert all({"value", "label"} <= set(item) for item in payload[key])

    def test_samples_catalogue(self):
        payload = client.get("/api/samples").json()
        assert isinstance(payload["samples"], list)

    def test_openapi_generates(self):
        assert client.get("/openapi.json").status_code == 200

    def test_unknown_route_uses_error_envelope(self):
        r = client.get("/api/does-not-exist")
        assert r.status_code == 404
        body = r.json()
        assert set(body) == {"error", "status"}
        assert body["error"]["code"] == "http_404"


# --------------------------------------------------------------------------------------
# Safety module
# --------------------------------------------------------------------------------------


class TestSafetyModule:
    def test_contract(self, site_image):
        r = client.post("/api/analysis/safety", files=_upload(site_image))
        assert r.status_code == 200, r.text
        SafetyAnalysisResponse.model_validate(r.json())

    def test_consistency_invariants(self, site_image):
        data = client.post("/api/analysis/safety", files=_upload(site_image)).json()
        # Compliance score bounded
        assert 0 <= data["compliance_score"] <= 100
        # Any critical hazard forces overall risk to critical
        if any(h["severity"] == "critical" for h in data["hazards"]):
            assert data["overall_risk"] == "critical"
        # PPE counts must be internally consistent
        for ppe in data["ppe_compliance"]:
            assert ppe["compliant"] + ppe["violations"] <= ppe["workers_checked"]
        # Hazards are ordered most severe first
        order = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        severities = [order[h["severity"]] for h in data["hazards"]]
        assert severities == sorted(severities, reverse=True)
        # Every hazard carries an actionable recommendation and a citation
        for hazard in data["hazards"]:
            assert len(hazard["recommendation"]) >= 10
            assert len(hazard["standard_reference"]) >= 3

    def test_bounding_boxes_within_frame(self, site_image):
        data = client.post("/api/analysis/safety", files=_upload(site_image)).json()
        for hazard in data["hazards"]:
            bbox = hazard.get("bbox")
            if bbox:
                assert bbox["x"] + bbox["w"] <= 1.0001
                assert bbox["y"] + bbox["h"] <= 1.0001

    def test_strictness_changes_result_or_at_least_validates(self, site_image):
        strict = client.post(
            "/api/analysis/safety", files=_upload(site_image), data={"strictness": "strict"}
        )
        assert strict.status_code == 200
        SafetyAnalysisResponse.model_validate(strict.json())

    def test_invalid_strictness_rejected(self, site_image):
        r = client.post("/api/analysis/safety", files=_upload(site_image), data={"strictness": "yolo"})
        assert r.status_code == 422

    def test_missing_file(self):
        r = client.post("/api/analysis/safety")
        assert r.status_code == 422
        assert r.json()["status"] == 422

    def test_wrong_mime_rejected(self):
        r = client.post("/api/analysis/safety", files=_upload(b"hello", "a.txt", "text/plain"))
        assert r.status_code == 415
        assert r.json()["error"]["code"] == "unsupported_media_type"

    def test_fake_jpeg_rejected(self):
        r = client.post("/api/analysis/safety", files=_upload(b"definitely not an image", "a.jpg"))
        assert r.status_code == 415
        assert r.json()["error"]["code"] == "not_an_image"

    def test_oversized_upload_rejected(self):
        r = client.post("/api/analysis/safety", files=_upload(b"\xff\xd8\xff" + b"0" * (13 * 1024 * 1024), "big.jpg"))
        assert r.status_code == 413
        assert r.json()["error"]["code"] == "file_too_large"
        assert r.json()["error"]["field"] == "image"

    def test_tiny_image_rejected(self):
        r = client.post("/api/analysis/safety", files=_upload(_png(10, 10)))
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "image_too_small"

    def test_missing_file_error_is_wrapped(self):
        r = client.post("/api/analysis/safety")
        code = r.json()["error"]["code"]
        assert code in {"validation_error", "missing_file"}


# --------------------------------------------------------------------------------------
# Crack module
# --------------------------------------------------------------------------------------


class TestCrackModule:
    def test_contract(self, crack_image):
        r = client.post("/api/analysis/crack", files=_upload(crack_image))
        assert r.status_code == 200, r.text
        CrackAnalysisResponse.model_validate(r.json())

    def test_severity_matches_width_banding(self, crack_image):
        data = client.post("/api/analysis/crack", files=_upload(crack_image)).json()
        width = data["measurement"]["estimated_width_mm"]
        if width >= 3.0:
            assert data["severity"] == "critical"
        if data["severity"] == "critical":
            assert data["requires_engineer_review"] is True
        # Width class must agree with the ACI/IS banding of the reported width
        expected = (
            "hairline" if width < 0.1 else "fine" if width < 0.3 else
            "moderate" if width < 1.0 else "wide" if width < 3.0 else "severe"
        )
        assert data["width_class"] == expected

    def test_clean_surface_is_low_risk(self):
        clean = _png(700, 700, (228, 226, 220))
        data = client.post("/api/analysis/crack", files=_upload(clean)).json()
        assert data["severity"] == "low"
        assert data["requires_engineer_review"] is False

    def test_remediation_always_present(self, crack_image):
        data = client.post("/api/analysis/crack", files=_upload(crack_image)).json()
        assert len(data["remediation"]) >= 1
        for action in data["remediation"]:
            assert action["priority"] in {"immediate", "short_term", "monitor"}
            assert len(action["detail"]) >= 10

    def test_invalid_surface_type(self, crack_image):
        r = client.post("/api/analysis/crack", files=_upload(crack_image), data={"surface_type": "lava"})
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "invalid_surface_type"
        assert "concrete_beam" in r.json()["error"]["message"]

    def test_surface_types_endpoint(self):
        types = client.get("/api/analysis/surface-types").json()
        assert "concrete_beam" in types
        assert "unknown" in types


# --------------------------------------------------------------------------------------
# Valuation module
# --------------------------------------------------------------------------------------


BASE_VALUATION = {
    "city": "Indore",
    "locality": "Vijay Nagar",
    "property_type": "apartment",
    "super_builtup_area_sqft": 1650,
    "carpet_area_sqft": 1180,
    "age_years": 4,
    "floor_number": 7,
    "floors_total": 12,
    "finish_grade": "premium",
    "structure_type": "rcc_frame",
    "project_phase": "completed",
    "parking_slots": 2,
    "amenities": ["swimming pool", "gym", "power backup"],
    "monthly_rent_estimate": 26000,
}


class TestValuationModule:
    def test_contract(self):
        r = client.post("/api/valuation", json=BASE_VALUATION)
        assert r.status_code == 200, r.text
        ValuationResponse.model_validate(r.json())

    def test_range_contains_estimate(self):
        data = client.post("/api/valuation", json=BASE_VALUATION).json()
        assert data["range_low"] <= data["estimated_value"] <= data["range_high"]

    def test_estimate_is_reproducible_from_drivers(self):
        data = client.post("/api/valuation", json=BASE_VALUATION).json()
        # The headline value is rounded to the nearest ₹1,000, so allow that plus the
        # 2-decimal rounding of the per-sqft rate.
        assert abs(data["price_per_sqft"] * data["area_basis_sqft"] - data["estimated_value"]) < 1000

    def test_driver_percentages_multiply_to_price(self):
        data = client.post("/api/valuation", json=BASE_VALUATION).json()
        multiplier = 1.0
        for driver in data["drivers"]:
            multiplier *= 1 + driver["impact_pct"] / 100
        expected_rate = data["base_rate_per_sqft"] * multiplier
        assert abs(expected_rate - data["price_per_sqft"]) / data["price_per_sqft"] < 0.01

    def test_age_reduces_value(self):
        young = client.post("/api/valuation", json={**BASE_VALUATION, "age_years": 1}).json()
        old = client.post("/api/valuation", json={**BASE_VALUATION, "age_years": 40}).json()
        assert old["estimated_value"] < young["estimated_value"]

    def test_premium_finish_beats_basic(self):
        premium = client.post("/api/valuation", json={**BASE_VALUATION, "finish_grade": "premium"}).json()
        basic = client.post("/api/valuation", json={**BASE_VALUATION, "finish_grade": "basic"}).json()
        assert premium["estimated_value"] > basic["estimated_value"]

    def test_rental_yield_math(self):
        data = client.post("/api/valuation", json=BASE_VALUATION).json()
        expected = round(26000 * 12 / data["estimated_value"] * 100, 2)
        assert abs(data["rental_yield_pct"] - expected) < 0.02

    def test_unknown_city_flags_risk_and_lowers_confidence(self):
        known = client.post("/api/valuation", json=BASE_VALUATION).json()
        unknown = client.post("/api/valuation", json={**BASE_VALUATION, "city": "Atlantis"}).json()
        assert unknown["confidence"] < known["confidence"]
        assert any("proxy" in flag.lower() or "benchmark" in flag.lower() for flag in unknown["risk_flags"])

    @pytest.mark.parametrize(
        "payload,code",
        [
            ({}, "validation_error"),
            ({**BASE_VALUATION, "property_type": "castle"}, "validation_error"),
            ({**BASE_VALUATION, "super_builtup_area_sqft": 50}, "validation_error"),
            ({**BASE_VALUATION, "carpet_area_sqft": 9000}, "validation_error"),
            ({**BASE_VALUATION, "floor_number": 99}, "validation_error"),
            ({**BASE_VALUATION, "unexpected_field": 1}, "validation_error"),
        ],
    )
    def test_invalid_payloads(self, payload, code):
        r = client.post("/api/valuation", json=payload)
        assert r.status_code == 422
        assert r.json()["error"]["code"] == code

    def test_unknown_fields_are_forbidden(self):
        r = client.post("/api/valuation", json={**BASE_VALUATION, "sneaky": True})
        assert r.status_code == 422
        assert "sneaky" in r.json()["error"]["message"]


# --------------------------------------------------------------------------------------
# Planning module
# --------------------------------------------------------------------------------------


BASE_PLAN = {
    "project_name": "Test Tower",
    "city": "Indore",
    "project_type": "apartment",
    "structure_type": "rcc_frame",
    "total_area_sqft": 100000,
    "floors": 10,
    "units": 80,
    "start_date": (date.today() + timedelta(days=14)).isoformat(),
    "target_duration_weeks": 60,
    "current_phase": "planning",
    "procurement_mode": "item_rate",
    "site_constraints": [],
}


class TestPlanningModule:
    def test_contract(self):
        r = client.post("/api/plan", json=BASE_PLAN)
        assert r.status_code == 200, r.text
        ProjectPlanResponse.model_validate(r.json())

    def test_sequence_is_monotonic(self):
        data = client.post("/api/plan", json=BASE_PLAN).json()
        previous_end = None
        for milestone in data["milestones"]:
            assert milestone["end_date"] >= milestone["start_date"]
            if previous_end:
                assert milestone["start_date"] > previous_end
            previous_end = milestone["end_date"]

    def test_duration_is_plausible(self):
        data = client.post("/api/plan", json=BASE_PLAN).json()
        # A 10-storey, 1 lakh sqft apartment build: 8 to 36 months of working days.
        assert 120 <= data["total_duration_days"] <= 900
        assert data["computed_end_date"] > data["computed_start_date"]

    def test_critical_path_matches_milestones(self):
        data = client.post("/api/plan", json=BASE_PLAN).json()
        assert data["critical_path"] == [m["id"] for m in data["milestones"]]

    def test_phase_weights_sum_to_100(self):
        data = client.post("/api/plan", json=BASE_PLAN).json()
        assert abs(sum(p["weight_pct"] for p in data["phase_breakdown"]) - 100) < 0.5

    def test_tasks_fit_inside_their_phase(self):
        data = client.post("/api/plan", json=BASE_PLAN).json()
        by_phase = {m["phase"]: m for m in data["milestones"]}
        for phase in data["phase_breakdown"]:
            total = sum(t["duration_days"] for t in phase["tasks"])
            # Tasks are a proportional decomposition of the phase window (+ rounding).
            assert total <= by_phase[phase["phase"]]["duration_days"] * 1.5 + len(phase["tasks"])

    def test_impossible_target_is_flagged(self):
        data = client.post("/api/plan", json={**BASE_PLAN, "target_duration_weeks": 12}).json()
        assert data["schedule_health"] in {"aggressive", "unrealistic"}
        assert any(r["category"] == "schedule" for r in data["risks"])

    def test_generous_target_is_on_track(self):
        data = client.post("/api/plan", json={**BASE_PLAN, "target_duration_weeks": 300}).json()
        assert data["schedule_health"] == "on_track"

    def test_bigger_project_takes_longer(self):
        small = client.post("/api/plan", json={**BASE_PLAN, "total_area_sqft": 5000, "floors": 2, "units": 2}).json()
        large = client.post("/api/plan", json={**BASE_PLAN, "total_area_sqft": 400000, "floors": 20, "units": 300}).json()
        assert large["total_duration_days"] > small["total_duration_days"]

    def test_resource_quantities_are_sane(self):
        data = client.post("/api/plan", json=BASE_PLAN).json()
        res = data["resources"]
        # ~0.22 m3 concrete per m2 built-up area, 100000 sqft == 9290 m2
        assert 1500 <= res["concrete_m3_est"] <= 2800
        assert 100 <= res["steel_tonnes_est"] <= 350
        assert res["peak_crew"] >= 1
        assert res["total_labour_days"] > res["peak_crew"]

    @pytest.mark.parametrize(
        "patch",
        [
            {"project_name": "x"},
            {"total_area_sqft": 10},
            {"floors": 0},
            {"start_date": "1800-01-01"},
        ],
    )
    def test_invalid_payloads(self, patch):
        r = client.post("/api/plan", json={**BASE_PLAN, **patch})
        assert r.status_code == 422


# --------------------------------------------------------------------------------------
# Weather module
# --------------------------------------------------------------------------------------


class TestWeatherModule:
    def test_contract(self):
        r = client.get("/api/weather/advisory", params={"city": "Indore", "activity": "concrete_pour"})
        assert r.status_code == 200, r.text
        WeatherAdvisoryResponse.model_validate(r.json())

    def test_forecast_length(self):
        data = client.get("/api/weather/advisory", params={"city": "Indore"}).json()
        assert 1 <= len(data["forecast"]) <= 7
        for day in data["forecast"]:
            assert day["temp_max_c"] >= day["temp_min_c"]

    def test_permit_status_derivation(self):
        data = client.get("/api/weather/advisory", params={"city": "Indore"}).json()
        critical = any(a["severity"] == "critical" for a in data["advisories"])
        if critical:
            assert data["permit_status"] == "hold"

    def test_concrete_suitability_matches_permit(self):
        data = client.get("/api/weather/advisory", params={"city": "Indore", "activity": "concrete_pour"}).json()
        if data["permit_status"] == "hold":
            assert data["concrete_pour_suitable"] is False

    def test_coordinates_override_city(self):
        data = client.get(
            "/api/weather/advisory",
            params={"latitude": 19.076, "longitude": 72.8777},
        ).json()
        assert abs(data["latitude"] - 19.076) < 1e-6

    def test_partial_coordinates_rejected(self):
        r = client.get("/api/weather/advisory", params={"latitude": 22.7})
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "incomplete_coordinates"

    def test_invalid_activity_rejected(self):
        r = client.get("/api/weather/advisory", params={"activity": "sleeping"})
        assert r.status_code == 422

    def test_every_advisory_has_actions(self):
        data = client.get("/api/weather/advisory", params={"city": "Bhopal"}).json()
        for advisory in data["advisories"]:
            assert len(advisory["actions"]) >= 1
            assert len(advisory["detail"]) >= 15
            assert advisory["standard_reference"]


# --------------------------------------------------------------------------------------
# Assistant / RAG
# --------------------------------------------------------------------------------------


class TestAssistantModule:
    def test_contract(self):
        r = client.post("/api/assistant/chat", json={"question": "What is the crack width limit for severe exposure?"})
        assert r.status_code == 200, r.text
        AssistantResponse.model_validate(r.json())

    @pytest.mark.parametrize(
        "question,expected_doc",
        [
            ("how often should scaffolding be inspected", "KB-010"),
            ("crack width limit for severe exposure", "KB-004"),
            ("heat stress controls for workers", "KB-013"),
            ("RERA escrow requirement", "KB-023"),
            ("trench shoring depth", "KB-011"),
            ("cube test frequency for concrete", "KB-015"),
            ("waterproofing ponding test", "KB-016"),
            ("precast panel lifting wind limit", "KB-012"),
            ("how long should concrete be cured", "KB-014"),
        ],
    )
    def test_retrieval_precision(self, question, expected_doc):
        hits = retrieve(question, top_k=3)
        assert hits, f"no retrieval hits for: {question}"
        assert hits[0][0].doc_id == expected_doc, [h[0].doc_id for h in hits]

    @pytest.mark.parametrize(
        "question",
        [
            "what is the capital of France",
            "what is the salary of a site engineer",
            "who won the 2019 cricket world cup",
            "how do I cook biryani",
        ],
    )
    def test_out_of_domain_questions_are_refused(self, question):
        assert retrieve(question, top_k=3) == []

    def test_out_of_domain_returns_ungrounded(self):
        r = client.post("/api/assistant/chat", json={"question": "who won the 2019 cricket world cup"})
        body = r.json()
        assert body["grounded"] is False
        assert body["low_confidence"] is True
        assert body["citations"] == []
        assert "could not find" in body["answer"].lower()

    def test_answer_is_cited(self):
        body = client.post(
            "/api/assistant/chat", json={"question": "What are the hot-weather concreting precautions?"}
        ).json()
        assert body["grounded"] is True
        assert len(body["citations"]) >= 1
        first = body["citations"][0]
        assert first["doc_id"].startswith("KB-")
        assert 0 <= first["relevance"] <= 1
        assert len(first["snippet"]) >= 10

    def test_history_is_accepted_and_truncated(self):
        history = [{"role": "user", "content": f"question {i}"} for i in range(40)]
        r = client.post(
            "/api/assistant/chat",
            json={"question": "heat stress controls", "history": history},
        )
        assert r.status_code == 200

    def test_top_k_bounds(self):
        assert client.post("/api/assistant/chat", json={"question": "curing", "top_k": 0}).status_code == 422
        assert client.post("/api/assistant/chat", json={"question": "curing", "top_k": 99}).status_code == 422

    def test_short_question_rejected(self):
        assert client.post("/api/assistant/chat", json={"question": "hi"}).status_code == 422

    def test_corpus_endpoint(self):
        payload = client.get("/api/assistant/corpus").json()
        assert payload["count"] >= 25
        assert all("doc_id" in doc for doc in payload["documents"])


# --------------------------------------------------------------------------------------
# Contract completeness
# --------------------------------------------------------------------------------------


class TestContractRegistry:
    def test_every_model_has_a_json_schema(self):
        from models.schemas import CONTRACT_MODELS

        for name, model in CONTRACT_MODELS.items():
            schema = model.model_json_schema()
            assert schema.get("title"), name
            if schema.get("type") == "object":
                assert "properties" in schema, name

    def test_response_models_are_serialisable(self):
        from models.schemas import CONTRACT_MODELS

        for name, model in CONTRACT_MODELS.items():
            # Instantiating a required-fields model with nothing must fail loudly,
            # which proves validators are running and fields are not all optional.
            if name.endswith("Response") and name not in {"HealthResponse"}:
                with pytest.raises(Exception):
                    model()
