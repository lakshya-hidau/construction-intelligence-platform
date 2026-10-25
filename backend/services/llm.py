"""
Provider-agnostic multimodal LLM client.

Design goals
------------
1. **Zero hard vendor lock-in.** OpenAI, Anthropic and Gemini are each a thin
   adapter over the same two methods: `vision_json()` and `text()`.
2. **Never crash the platform.** If no key is configured, or a provider call fails,
   the caller falls back to the deterministic heuristic engines and the response is
   explicitly labelled `engine_mode="heuristic"` with a disclosure string.
3. **Strict output contracts.** Every vision call is asked for JSON, parsed
   defensively (code fences stripped, first balanced object extracted) and then
   validated by the caller against a Pydantic model. One repair attempt is made
   with the validation error appended to the prompt.
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from config import settings

logger = logging.getLogger("cip.llm")

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)
_VALID_JSON_SUFFIX = re.compile(r"^[^\{]*")


class LLMError(RuntimeError):
    """Raised when a provider call fails or returns unusable output."""


@dataclass(slots=True)
class VisionImage:
    data: bytes
    media_type: str = "image/jpeg"


@dataclass(slots=True)
class LLMResult:
    payload: str
    provider: str
    model: str
    latency_ms: int


def extract_json_object(raw: str) -> dict[str, Any]:
    """Best-effort extraction of a single JSON object from model output."""
    if not raw or not raw.strip():
        raise LLMError("empty model response")

    text = raw.strip()
    fence = _FENCE_RE.search(text)
    if fence:
        text = fence.group(1).strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # Walk the string and return the first balanced {...} block.
    start = text.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escape = False
        for idx in range(start, len(text)):
            ch = text[idx]
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start : idx + 1]
                    try:
                        parsed = json.loads(candidate)
                        if isinstance(parsed, dict):
                            return parsed
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)

    raise LLMError("model response did not contain a parseable JSON object")


class MultimodalClient:
    """Single entry point used by every service that needs a model."""

    def __init__(self) -> None:
        self.provider = settings.resolved_provider()
        self.model = settings.resolved_model()
        self.timeout = settings.llm_timeout_seconds

    # -- capability ----------------------------------------------------------------
    @property
    def available(self) -> bool:
        if self.provider == "openai":
            return bool(settings.openai_api_key)
        if self.provider == "anthropic":
            return bool(settings.anthropic_api_key)
        if self.provider == "gemini":
            return bool(settings.gemini_api_key)
        return False

    @property
    def vision_capable(self) -> bool:
        return self.available

    # -- public API -----------------------------------------------------------------
    def vision_json(
        self,
        system: str,
        prompt: str,
        images: list[VisionImage],
        *,
        temperature: float = 0.1,
        max_tokens: int | None = None,
    ) -> tuple[dict[str, Any], LLMResult]:
        if not self.available:
            raise LLMError(f"provider '{self.provider}' is not configured")
        started = time.perf_counter()
        raw = self._dispatch(system, prompt, images, temperature, max_tokens)
        latency = int((time.perf_counter() - started) * 1000)
        payload = extract_json_object(raw)
        return payload, LLMResult(raw, self.provider, self.model, latency)

    def text(
        self,
        system: str,
        prompt: str,
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        json_mode: bool = False,
    ) -> tuple[str, LLMResult]:
        if not self.available:
            raise LLMError(f"provider '{self.provider}' is not configured")
        started = time.perf_counter()
        raw = self._dispatch(system, prompt, [], temperature, max_tokens, json_mode=json_mode)
        latency = int((time.perf_counter() - started) * 1000)
        return raw, LLMResult(raw, self.provider, self.model, latency)

    # -- dispatch --------------------------------------------------------------------
    def _dispatch(
        self,
        system: str,
        prompt: str,
        images: list[VisionImage],
        temperature: float,
        max_tokens: int | None,
        *,
        json_mode: bool = True,
    ) -> str:
        tokens = max_tokens or settings.llm_max_output_tokens
        try:
            if self.provider == "openai":
                return self._openai(system, prompt, images, temperature, tokens, json_mode)
            if self.provider == "anthropic":
                return self._anthropic(system, prompt, images, temperature, tokens)
            if self.provider == "gemini":
                return self._gemini(system, prompt, images, temperature, tokens, json_mode)
        except httpx.TimeoutException as exc:  # pragma: no cover - network dependent
            raise LLMError(f"{self.provider} request timed out after {self.timeout}s") from exc
        except httpx.HTTPStatusError as exc:  # pragma: no cover
            body = exc.response.text[:400]
            raise LLMError(f"{self.provider} returned HTTP {exc.response.status_code}: {body}") from exc
        except httpx.HTTPError as exc:  # pragma: no cover
            raise LLMError(f"{self.provider} transport error: {exc}") from exc
        raise LLMError(f"unsupported provider '{self.provider}'")

    # -- providers -------------------------------------------------------------------
    def _openai(
        self,
        system: str,
        prompt: str,
        images: list[VisionImage],
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> str:
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for img in images:
            b64 = base64.b64encode(img.data).decode("ascii")
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{img.media_type};base64,{b64}", "detail": "high"},
                }
            )
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(
                f"{settings.openai_base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"] or ""

    def _anthropic(
        self,
        system: str,
        prompt: str,
        images: list[VisionImage],
        temperature: float,
        max_tokens: int,
    ) -> str:
        content: list[dict[str, Any]] = []
        for img in images:
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": img.media_type,
                        "data": base64.b64encode(img.data).decode("ascii"),
                    },
                }
            )
        content.append({"type": "text", "text": prompt})
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings.anthropic_api_key or "",
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "system": system,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "messages": [{"role": "user", "content": content}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
        blocks = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
        return "\n".join(blocks)

    def _gemini(
        self,
        system: str,
        prompt: str,
        images: list[VisionImage],
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> str:
        parts: list[dict[str, Any]] = [{"text": f"{system}\n\n{prompt}"}]
        for img in images:
            parts.append(
                {
                    "inline_data": {
                        "mime_type": img.media_type,
                        "data": base64.b64encode(img.data).decode("ascii"),
                    }
                }
            )
        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }
        if json_mode:
            generation_config["responseMimeType"] = "application/json"
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent?key={settings.gemini_api_key}"
        )
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(
                url,
                headers={"Content-Type": "application/json"},
                json={"contents": [{"role": "user", "parts": parts}], "generationConfig": generation_config},
            )
            resp.raise_for_status()
            data = resp.json()
        candidates = data.get("candidates") or []
        if not candidates:
            raise LLMError("gemini returned no candidates (possible safety block)")
        chunks = candidates[0].get("content", {}).get("parts", [])
        return "".join(part.get("text", "") for part in chunks)


_client_singleton: MultimodalClient | None = None


def get_llm() -> MultimodalClient:
    global _client_singleton
    if _client_singleton is None:
        _client_singleton = MultimodalClient()
    return _client_singleton


def reset_llm() -> None:
    """Used by tests when settings are monkey-patched."""
    global _client_singleton
    _client_singleton = None
