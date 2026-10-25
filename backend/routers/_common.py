"""Shared request plumbing: request IDs, upload validation, error normalisation."""

from __future__ import annotations

import logging
import uuid
from typing import Iterable

from fastapi import HTTPException, UploadFile, status

from config import settings
from models.schemas import ErrorDetail, ErrorResponse
from services.image_ops import ImageDecodeError, decode_image

logger = logging.getLogger("cip.api")

MAX_DIMENSION = 12_000
MIN_DIMENSION = 32


def request_id_from(header_value: str | None) -> str:
    if header_value and 0 < len(header_value) <= 64:
        return header_value
    return uuid.uuid4().hex


def _sniff_is_image(head: bytes) -> bool:
    return (
        head.startswith(b"\xff\xd8\xff")  # JPEG
        or head.startswith(b"\x89PNG\r\n\x1a\n")  # PNG
        or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")  # WebP
    )


async def read_validated_image(file: UploadFile, *, field: str = "image") -> tuple[bytes, str, str]:
    """Read, size-check and MIME-check an upload. Returns (bytes, filename, content_type)."""
    if file is None or not file.filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": ErrorDetail(
                    code="missing_file",
                    message="An image file is required in the multipart form field 'image'.",
                    field=field,
                ).model_dump(),
                "status": 422,
            },
        )

    declared = (file.content_type or "").lower().split(";")[0].strip()
    if declared and declared not in settings.allowed_image_type_list:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={
                "error": ErrorDetail(
                    code="unsupported_media_type",
                    message=(
                        f"'{declared}' is not accepted. Allowed types: "
                        f"{', '.join(sorted(settings.allowed_image_type_list))}. HEIC/DWG/PDF are not supported."
                    ),
                    field=field,
                ).model_dump(),
                "status": 415,
            },
        )

    raw = await file.read()
    size = len(raw)

    if size == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": ErrorDetail(code="empty_file", message="The uploaded file is empty.", field=field).model_dump(),
                "status": 422,
            },
        )
    if size > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "error": ErrorDetail(
                    code="file_too_large",
                    message=(
                        f"Image is {size / 1_048_576:.1f} MB but the limit is "
                        f"{settings.max_upload_mb:.0f} MB. Downscale the photo and retry."
                    ),
                    field=field,
                ).model_dump(),
                "status": 413,
            },
        )

    if not _sniff_is_image(raw[:16]):
        # A real image that lies about its MIME type still passes; a non-image never does.
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={
                "error": ErrorDetail(
                    code="not_an_image",
                    message="The file content is not a valid JPEG, PNG or WebP image.",
                    field=field,
                ).model_dump(),
                "status": 415,
            },
        )

    return raw, file.filename, declared or "image/jpeg"


def validate_decodable(raw: bytes, field: str = "image") -> None:
    try:
        img = decode_image(raw)
    except ImageDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": ErrorDetail(code="undecodable_image", message=str(exc), field=field).model_dump(),
                "status": 422,
            },
        ) from exc

    if min(img.width, img.height) < MIN_DIMENSION:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": ErrorDetail(
                    code="image_too_small",
                    message=f"Image is {img.width}x{img.height}px; minimum is {MIN_DIMENSION}px on the short edge.",
                    field=field,
                ).model_dump(),
                "status": 422,
            },
        )
    if max(img.width, img.height) > MAX_DIMENSION:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": ErrorDetail(
                    code="image_too_large",
                    message=f"Image is {img.width}x{img.height}px; maximum is {MAX_DIMENSION}px on the long edge.",
                    field=field,
                ).model_dump(),
                "status": 422,
            },
        )


def error_body(code: str, message: str, *, field: str | None = None, request_id: str | None = None) -> dict:
    return ErrorResponse(
        error=ErrorDetail(code=code, message=message, field=field, request_id=request_id),
        status=500,
    ).model_dump(mode="json")


def join_validation_errors(errors: Iterable[dict]) -> str:
    parts = []
    for err in errors:
        loc = ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query", "path"))
        msg = err.get("msg", "invalid value")
        parts.append(f"{loc}: {msg}" if loc else msg)
    return "; ".join(parts)[:600]
