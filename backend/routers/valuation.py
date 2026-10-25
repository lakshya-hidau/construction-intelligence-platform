"""Module 3 endpoints — real estate valuation and automated project planning."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status

from models.schemas import (
    ErrorResponse,
    ProjectPlanRequest,
    ProjectPlanResponse,
    ValuationRequest,
    ValuationResponse,
)
from routers._common import request_id_from
from services import planner as planner_service
from services import valuation as valuation_service

logger = logging.getLogger("cip.api.valuation")

router = APIRouter(prefix="/api", tags=["valuation & planning"])

_ERRORS = {
    422: {"model": ErrorResponse, "description": "Payload failed contract validation"},
    500: {"model": ErrorResponse, "description": "Unexpected server error"},
}


@router.post(
    "/valuation",
    response_model=ValuationResponse,
    summary="Predictive real estate valuation with itemised value drivers",
    responses=_ERRORS,
)
async def valuate(
    payload: ValuationRequest,
    x_request_id: Annotated[str | None, Header()] = None,
) -> ValuationResponse:
    request_id = request_id_from(x_request_id)
    try:
        return valuation_service.value_property(payload, request_id=request_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": {
                    "code": "valuation_input_invalid",
                    "message": str(exc),
                    "request_id": request_id,
                },
                "status": 422,
            },
        ) from exc
    except Exception as exc:  # pragma: no cover
        logger.exception("valuation crashed rid=%s", request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": {
                    "code": "valuation_failed",
                    "message": "Valuation engine failed. The incident has been logged.",
                    "request_id": request_id,
                },
                "status": 500,
            },
        ) from exc


@router.post(
    "/plan",
    response_model=ProjectPlanResponse,
    summary="Generate milestones, phase breakdowns, resources and risks",
    responses=_ERRORS,
)
async def plan(
    payload: ProjectPlanRequest,
    x_request_id: Annotated[str | None, Header()] = None,
) -> ProjectPlanResponse:
    request_id = request_id_from(x_request_id)
    try:
        return planner_service.plan_project(payload, request_id=request_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": {"code": "plan_input_invalid", "message": str(exc), "request_id": request_id},
                "status": 422,
            },
        ) from exc
    except Exception as exc:  # pragma: no cover
        logger.exception("plan crashed rid=%s", request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": {
                    "code": "plan_failed",
                    "message": "Planning engine failed. The incident has been logged.",
                    "request_id": request_id,
                },
                "status": 500,
            },
        ) from exc
