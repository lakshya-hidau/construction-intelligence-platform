"""Module 1 & 2 endpoints — multimodal image analysis (safety + crack)."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile, status

from models.schemas import (
    CrackAnalysisResponse,
    ErrorResponse,
    SafetyAnalysisResponse,
    SurfaceType,
)
from routers._common import read_validated_image, request_id_from, validate_decodable
from services import crack as crack_service
from services import safety as safety_service
from services.image_ops import ImageDecodeError
from services.llm import LLMError

logger = logging.getLogger("cip.api.analysis")

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

_COMMON_ERRORS = {
    413: {"model": ErrorResponse, "description": "Upload exceeds the size limit"},
    415: {"model": ErrorResponse, "description": "Unsupported or invalid image format"},
    422: {"model": ErrorResponse, "description": "Validation or image decoding failure"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
    503: {"model": ErrorResponse, "description": "Analysis engine unavailable"},
}


@router.post(
    "/safety",
    response_model=SafetyAnalysisResponse,
    summary="Audit a site photograph for OHS hazards and PPE compliance",
    responses=_COMMON_ERRORS,
)
async def analyze_safety(
    image: Annotated[UploadFile, File(description="Site photograph (JPEG/PNG/WebP)")],
    site_context: Annotated[str | None, Form(max_length=300)] = None,
    strictness: Annotated[str, Form(pattern="^(standard|strict)$")] = "standard",
    x_request_id: Annotated[str | None, Header()] = None,
) -> SafetyAnalysisResponse:
    request_id = request_id_from(x_request_id)
    raw, filename, content_type = await read_validated_image(image, field="image")
    validate_decodable(raw, field="image")

    try:
        return safety_service.analyze_safety(
            raw,
            filename=filename,
            content_type=content_type,
            site_context=site_context,
            strictness=strictness,
            request_id=request_id,
        )
    except ImageDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "undecodable_image", "message": str(exc), "request_id": request_id}, "status": 422},
        ) from exc
    except LLMError as exc:
        logger.warning("safety llm failure rid=%s: %s", request_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": {
                    "code": "analysis_engine_unavailable",
                    "message": "The vision engine could not process this image. Retry shortly.",
                    "request_id": request_id,
                },
                "status": 503,
            },
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive boundary
        logger.exception("safety analysis crashed rid=%s", request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": {
                    "code": "analysis_failed",
                    "message": "Safety analysis failed unexpectedly. The incident has been logged.",
                    "request_id": request_id,
                },
                "status": 500,
            },
        ) from exc


@router.post(
    "/crack",
    response_model=CrackAnalysisResponse,
    summary="Detect and grade structural cracking in a surface photograph",
    responses=_COMMON_ERRORS,
)
async def analyze_crack(
    image: Annotated[UploadFile, File(description="Structural surface photograph (JPEG/PNG/WebP)")],
    notes: Annotated[str | None, Form(max_length=800)] = None,
    surface_type: Annotated[str, Form()] = SurfaceType.UNKNOWN.value,
    x_request_id: Annotated[str | None, Header()] = None,
) -> CrackAnalysisResponse:
    request_id = request_id_from(x_request_id)

    try:
        hint = SurfaceType(surface_type.lower())
    except ValueError as exc:
        allowed = ", ".join(s.value for s in SurfaceType)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": {
                    "code": "invalid_surface_type",
                    "message": f"surface_type must be one of: {allowed}",
                    "field": "surface_type",
                    "request_id": request_id,
                },
                "status": 422,
            },
        ) from exc

    raw, filename, content_type = await read_validated_image(image, field="image")
    validate_decodable(raw, field="image")

    try:
        return crack_service.analyze_crack(
            raw,
            filename=filename,
            content_type=content_type,
            notes=notes,
            surface_hint=hint,
            request_id=request_id,
        )
    except ImageDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "undecodable_image", "message": str(exc), "request_id": request_id}, "status": 422},
        ) from exc
    except Exception as exc:  # pragma: no cover
        logger.exception("crack analysis crashed rid=%s", request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": {
                    "code": "analysis_failed",
                    "message": "Crack analysis failed unexpectedly. The incident has been logged.",
                    "request_id": request_id,
                },
                "status": 500,
            },
        ) from exc


@router.get(
    "/surface-types",
    response_model=list[str],
    summary="Enumerate valid surface type values for the crack module",
)
async def surface_types() -> list[str]:
    return [s.value for s in SurfaceType]
