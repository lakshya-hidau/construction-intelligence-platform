"""
Multimodal Construction Intelligence Platform — FastAPI application entry point.

Run locally:
    uvicorn main:app --reload --port 8000

The app serves:
  * /api/*         JSON API (OpenAPI docs at /docs, /redoc, /openapi.json)
  * /health        liveness + engine capability probe
  * /              the built React SPA (if frontend/dist has been built), else an API index
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import settings
from models.schemas import (
    CONTRACT_MODELS,
    EngineMode,
    ErrorDetail,
    ErrorResponse,
    HealthResponse,
)
from routers import advisory as advisory_router
from routers import analysis as analysis_router
from routers import valuation as valuation_router
from routers._common import join_validation_errors

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s :: %(message)s",
)
logger = logging.getLogger("cip")

STARTED_AT = time.time()
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    from services.knowledge import corpus_size
    from services.llm import get_llm

    client = get_llm()
    logger.info("=" * 78)
    logger.info("%s v%s", settings.app_name, settings.app_version)
    logger.info("AI engine      : %s (%s)", client.provider, client.model)
    logger.info("LLM configured : %s", "yes" if client.available else "no — heuristic mode")
    logger.info("Weather source : %s", settings.weather_provider)
    logger.info("Knowledge docs : %s", corpus_size())
    logger.info("CORS origins   : %s", ", ".join(settings.cors_origin_list))
    logger.info("SPA dist       : %s (%s)", FRONTEND_DIST, "found" if FRONTEND_DIST.is_dir() else "not built")
    logger.info("=" * 78)
    yield
    logger.info("shutting down")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Decision-support API for construction professionals. Four modules: site safety "
        "monitoring, crack detection & structural analysis, valuation & project planning, and "
        "weather-aware advisory with a RAG knowledge assistant. Every response is constrained by "
        "an explicit Pydantic contract."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# -- middlewares --------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|[\w-]+\.e2b\.app|[\w-]+\.arena\.ai)(:\d+)?$"
    if settings.environment != "production"
    else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Process-Time-Ms"],
    max_age=600,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def attach_request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    request.state.request_id = request_id
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time-Ms"] = str(elapsed_ms)
    if request.url.path.startswith("/api"):
        logger.info(
            "%s %s -> %s (%dms) rid=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id[:8],
        )
    return response


# -- exception handlers -------------------------------------------------------------------
def _rid(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorDetail(
            code="validation_error",
            message=join_validation_errors(exc.errors()),
            request_id=_rid(request),
        ),
        status=status.HTTP_422_UNPROCESSABLE_ENTITY,
    )
    return JSONResponse(status_code=422, content=body.model_dump(mode="json"))


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail:
        payload = ErrorResponse(
            error=ErrorDetail(
                code=str(detail["error"].get("code", "http_error")),
                message=str(detail["error"].get("message", "Request failed.")),
                field=detail["error"].get("field"),
                request_id=detail["error"].get("request_id") or _rid(request),
            ),
            status=exc.status_code,
        )
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump(mode="json"), headers=exc.headers)

    payload = ErrorResponse(
        error=ErrorDetail(
            code=f"http_{exc.status_code}",
            message=str(detail) if detail else "Request failed.",
            request_id=_rid(request),
        ),
        status=exc.status_code,
    )
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump(mode="json"), headers=exc.headers)


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    payload = ErrorResponse(
        error=ErrorDetail(
            code="internal_error",
            message="An unexpected server error occurred. Quote the request id when reporting it.",
            request_id=_rid(request),
        ),
        status=500,
    )
    return JSONResponse(status_code=500, content=payload.model_dump(mode="json"))


# -- routes -------------------------------------------------------------------------------
app.include_router(analysis_router.router)
app.include_router(valuation_router.router)
app.include_router(advisory_router.router)


@app.get("/health", response_model=HealthResponse, tags=["system"], summary="Liveness and capability probe")
async def health() -> HealthResponse:
    from services.knowledge import corpus_size
    from services.llm import get_llm

    client = get_llm()
    return HealthResponse(
        status="ok",
        version=settings.app_version,
        engine_mode=EngineMode.LLM if client.available else EngineMode.HEURISTIC,
        provider=client.provider,
        model=client.model,
        vision_enabled=client.vision_capable,
        llm_configured=settings.llm_configured,
        weather_provider=settings.weather_provider,
        uptime_seconds=int(time.time() - STARTED_AT),
        knowledge_chunks=corpus_size(),
    )


@app.get("/api/contracts", tags=["system"], summary="Machine-readable list of API contracts")
async def contracts() -> dict[str, object]:
    return {
        "models": {name: model.model_json_schema() for name, model in CONTRACT_MODELS.items()},
        "count": len(CONTRACT_MODELS),
    }


@app.get("/api/options", tags=["system"], summary="Enumerations used by the UI form controls")
async def options() -> dict[str, object]:
    from models.schemas import (
        ActivityType,
        CrackType,
        FinishGrade,
        ProjectPhase,
        PropertyType,
        StructureType,
        SurfaceType,
        Trade,
    )

    def enum_list(enum_cls) -> list[dict[str, str]]:
        return [{"value": e.value, "label": e.value.replace("_", " ").title()} for e in enum_cls]

    return {
        "property_types": enum_list(PropertyType),
        "finish_grades": enum_list(FinishGrade),
        "structure_types": enum_list(StructureType),
        "project_phases": enum_list(ProjectPhase),
        "surface_types": enum_list(SurfaceType),
        "crack_types": enum_list(CrackType),
        "activity_types": enum_list(ActivityType),
        "trades": enum_list(Trade),
    }


# -- sample assets ------------------------------------------------------------------------
# Curated sample images let a reviewer exercise the vision modules in one click.
STATIC_DIR = Path(__file__).resolve().parent / settings.static_dir
if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/api/samples", tags=["system"], summary="Curated sample images for the vision modules")
    async def samples() -> dict[str, object]:
        samples_dir = STATIC_DIR / "samples"
        catalogue = [
            {
                "id": "site-01",
                "label": "Site with PPE non-compliance",
                "module": "safety",
                "url": "/static/samples/site-01.jpg",
                "note": "Concrete deck: two compliant operatives, one bare-headed worker without hi-vis.",
            },
            {
                "id": "crack-01",
                "label": "Diagonal shear crack in a beam",
                "module": "crack",
                "url": "/static/samples/crack-01.jpg",
                "note": "Close-up of a diagonal crack with branching on a concrete soffit.",
            },
            {
                "id": "wall-01",
                "label": "Sound plastered wall",
                "module": "crack",
                "url": "/static/samples/wall-01.jpg",
                "note": "Neutral control case — a clean surface that should grade low.",
            },
        ]
        return {
            "samples": [item for item in catalogue if (samples_dir / f"{item['id']}.jpg").is_file()],
        }


# -- static frontend ----------------------------------------------------------------------
if settings.serve_frontend and FRONTEND_DIST.is_dir():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/", include_in_schema=False)
    async def spa_root() -> FileResponse:
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        if full_path.startswith(("api/", "docs", "redoc", "openapi.json", "health")):
            raise StarletteHTTPException(status_code=404, detail="Not found")
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
else:

    @app.get("/", include_in_schema=False)
    async def api_index() -> dict[str, object]:
        return {
            "name": settings.app_name,
            "version": settings.app_version,
            "docs": "/docs",
            "health": "/health",
            "modules": {
                "safety": "POST /api/analysis/safety",
                "crack": "POST /api/analysis/crack",
                "valuation": "POST /api/valuation",
                "planning": "POST /api/plan",
                "weather": "GET  /api/weather/advisory",
                "assistant": "POST /api/assistant/chat",
            },
            "spa_built": FRONTEND_DIST.is_dir(),
        }


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=settings.debug)
