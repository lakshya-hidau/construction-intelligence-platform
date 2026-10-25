"""Typed application settings, loaded from environment / .env with safe defaults."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # -- App -------------------------------------------------------------------------
    app_name: str = "Multimodal Construction Intelligence Platform"
    app_version: str = "1.0.0"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False

    # -- CORS ------------------------------------------------------------------------
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:4173,http://127.0.0.1:4173"
    )

    # -- AI provider -----------------------------------------------------------------
    # "auto" walks the chain: configured LLM -> heuristic fallback.
    ai_provider: Literal["auto", "openai", "anthropic", "gemini", "heuristic"] = "auto"
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-3-7-sonnet-latest"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"
    llm_timeout_seconds: float = 60.0
    llm_max_output_tokens: int = 2000

    # -- Uploads ---------------------------------------------------------------------
    max_upload_mb: float = 12.0
    allowed_image_types: str = "image/jpeg,image/png,image/webp"

    # -- Weather ---------------------------------------------------------------------
    weather_provider: Literal["open-meteo", "simulated"] = "open-meteo"
    weather_timeout_seconds: float = 6.0
    default_latitude: float = 22.7196  # Indore, MP
    default_longitude: float = 75.8577
    default_city: str = "Indore"

    # -- Storage ---------------------------------------------------------------------
    static_dir: str = "static"
    serve_frontend: bool = True

    @field_validator("openai_api_key", "anthropic_api_key", "gemini_api_key", mode="before")
    @classmethod
    def _blank_to_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_image_type_list(self) -> set[str]:
        return {t.strip().lower() for t in self.allowed_image_types.split(",") if t.strip()}

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)

    def resolved_provider(self) -> str:
        """Return the concrete provider that will serve AI requests."""
        if self.ai_provider != "auto":
            return self.ai_provider
        if self.openai_api_key:
            return "openai"
        if self.anthropic_api_key:
            return "anthropic"
        if self.gemini_api_key:
            return "gemini"
        return "heuristic"

    def resolved_model(self) -> str:
        provider = self.resolved_provider()
        return {
            "openai": self.openai_model,
            "anthropic": self.anthropic_model,
            "gemini": self.gemini_model,
            "heuristic": "cv-heuristics-v1",
        }[provider]

    @property
    def llm_configured(self) -> bool:
        return self.resolved_provider() in {"openai", "anthropic", "gemini"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
