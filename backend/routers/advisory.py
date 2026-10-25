"""Module 4 endpoints — weather-aware advisory and the RAG knowledge assistant."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, status

from models.schemas import (
    ActivityType,
    AssistantQuery,
    AssistantResponse,
    ErrorResponse,
    WeatherAdvisoryResponse,
)
from routers._common import request_id_from
from services import knowledge as knowledge_service
from services import weather as weather_service
from services.llm import LLMError

logger = logging.getLogger("cip.api.advisory")

router = APIRouter(prefix="/api", tags=["weather & assistant"])


@router.get(
    "/weather/advisory",
    response_model=WeatherAdvisoryResponse,
    summary="Weather-driven permit status and construction advisories",
    responses={
        422: {"model": ErrorResponse, "description": "Invalid query parameters"},
        502: {"model": ErrorResponse, "description": "Weather provider failure with no fallback"},
    },
)
async def weather_advisory(
    city: Annotated[str | None, Query(min_length=2, max_length=80)] = None,
    latitude: Annotated[float | None, Query(ge=-90, le=90)] = None,
    longitude: Annotated[float | None, Query(ge=-180, le=180)] = None,
    activity: Annotated[ActivityType, Query()] = ActivityType.GENERAL_SITE,
    x_request_id: Annotated[str | None, Header()] = None,
) -> WeatherAdvisoryResponse:
    request_id = request_id_from(x_request_id)

    if (latitude is None) != (longitude is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": {
                    "code": "incomplete_coordinates",
                    "message": "Provide both latitude and longitude, or neither (and use city instead).",
                    "request_id": request_id,
                },
                "status": 422,
            },
        )

    try:
        return weather_service.build_advisory(city, latitude, longitude, activity, request_id)
    except Exception as exc:  # pragma: no cover
        logger.exception("weather advisory crashed rid=%s", request_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "error": {
                    "code": "weather_unavailable",
                    "message": "Weather data could not be retrieved and the simulator failed too.",
                    "request_id": request_id,
                },
                "status": 502,
            },
        ) from exc


@router.post(
    "/assistant/chat",
    response_model=AssistantResponse,
    summary="Ask the RAG construction knowledge assistant",
    responses={
        422: {"model": ErrorResponse, "description": "Payload failed contract validation"},
        500: {"model": ErrorResponse, "description": "Unexpected server error"},
    },
)
async def assistant_chat(
    payload: AssistantQuery,
    x_request_id: Annotated[str | None, Header()] = None,
) -> AssistantResponse:
    request_id = request_id_from(x_request_id)
    try:
        return knowledge_service.answer_question(payload, request_id=request_id)
    except LLMError as exc:
        logger.warning("assistant llm failure rid=%s: %s", request_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": {
                    "code": "assistant_unavailable",
                    "message": "The knowledge assistant could not generate an answer. Retry shortly.",
                    "request_id": request_id,
                },
                "status": 503,
            },
        ) from exc
    except Exception as exc:  # pragma: no cover
        logger.exception("assistant crashed rid=%s", request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": {
                    "code": "assistant_failed",
                    "message": "The knowledge assistant failed unexpectedly.",
                    "request_id": request_id,
                },
                "status": 500,
            },
        ) from exc


@router.get(
    "/assistant/corpus",
    summary="List the documents available to the knowledge assistant",
)
async def corpus() -> dict[str, object]:
    docs = knowledge_service.list_documents()
    return {"count": len(docs), "documents": docs}
