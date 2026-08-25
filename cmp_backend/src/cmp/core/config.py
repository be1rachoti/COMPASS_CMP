"""Centralised, validated configuration.

Every setting is read once at import time and validated by pydantic. A malformed
environment fails the process at startup rather than at the first request that
happens to touch the bad value.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["local", "test", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="forbid",  # an unknown env var is a typo, not a feature
        case_sensitive=False,
    )

    # ---------------------------------------------------------------- service
    environment: Environment = "local"
    service_name: str = "cmp-api"
    version: str = "0.1.0"
    debug: bool = False
    root_path: str = ""

    # ---------------------------------------------------------------- database
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "cmp"
    postgres_user: str = "cmp"
    postgres_password: SecretStr = SecretStr("cmp")
    db_pool_min_size: int = 2
    db_pool_max_size: int = 10
    db_pool_timeout_s: float = 10.0
    db_statement_timeout_ms: int = 15_000
    db_lock_timeout_ms: int = 5_000

    # ---------------------------------------------------------------- redis
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # ---------------------------------------------------------------- security
    secret_key: SecretStr = SecretStr("dev-only-change-me-dev-only-change-me-32")
    session_ttl_s: int = 60 * 60 * 8          # absolute session lifetime
    session_idle_timeout_s: int = 60 * 30     # sliding idle timeout
    cookie_name: str = "cmp_session"
    csrf_cookie_name: str = "cmp_csrf"
    csrf_header_name: str = "X-CSRF-Token"
    cookie_secure: bool = True
    cookie_domain: str | None = None
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    # Account protection — R-AUT-03
    login_max_attempts: int = 5
    login_lockout_window_s: int = 60 * 30
    login_lockout_duration_s: int = 60 * 30

    # OTP — public consent flow and data-subject sign-in
    otp_length: int = 6
    otp_ttl_s: int = 60 * 10
    otp_max_verify_attempts: int = 5
    otp_requests_per_contact_per_hour: int = 5
    otp_requests_per_token_per_hour: int = 20

    # MFA — staff step-up
    mfa_required_roles: Annotated[tuple[str, ...], NoDecode] = ("dpo", "admin")
    mfa_ttl_s: int = 60 * 5
    mfa_max_verify_attempts: int = 5

    # ---------------------------------------------------------------- CORS
    cors_origins: Annotated[tuple[str, ...], NoDecode] = ("http://localhost:3000",)
    trusted_hosts: Annotated[tuple[str, ...], NoDecode] = ("*",)

    # ---------------------------------------------------------------- uploads
    max_upload_bytes: int = 25 * 1024 * 1024  # 25 MB — approval proof, import manifest
    upload_root: str = "./var/uploads"
    allowed_proof_mime: Annotated[tuple[str, ...], NoDecode] = (
        "application/pdf",
        "image/png",
        "image/jpeg",
    )
    allowed_manifest_mime: Annotated[tuple[str, ...], NoDecode] = (
        "text/csv",
        "application/json",
        "application/vnd.ms-excel",
        "text/plain",
    )

    # ---------------------------------------------------------------- limits
    default_page_size: int = 50
    max_page_size: int = 200
    public_link_rate_per_minute: int = 60

    # ---------------------------------------------------------------- external
    notification_email_from: str = "privacy@example.org"
    external_http_timeout_s: float = 10.0     # never infinite — checklist §13
    external_http_retries: int = 3

    # ---------------------------------------------------------------- logging
    log_level: str = "INFO"
    log_json: bool = True

    @field_validator(
        "cors_origins",
        "trusted_hosts",
        "mfa_required_roles",
        "allowed_proof_mime",
        "allowed_manifest_mime",
        mode="before",
    )
    @classmethod
    def _split_csv(cls, v: object) -> object:
        """Accept `a,b,c` from the environment.

        These fields are annotated `NoDecode` so pydantic-settings hands us the
        raw string instead of trying to JSON-parse it first. Without that, a
        perfectly ordinary `CORS_ORIGINS=http://a,http://b` in a .env file fails
        at startup with a JSON decoding error that names neither the field nor
        the cause.
        """
        if isinstance(v, str):
            return tuple(part.strip() for part in v.split(",") if part.strip())
        return v

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        """Refuse to boot production with development defaults."""
        if self.environment == "production":
            weak = self.secret_key.get_secret_value()
            if weak.startswith("dev-only") or len(weak) < 32:
                raise ValueError("SECRET_KEY must be a real 32+ byte secret in production")
            if self.postgres_password.get_secret_value() in {"cmp", "postgres", ""}:
                raise ValueError("POSTGRES_PASSWORD must not be a default in production")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true in production")
            if self.debug:
                raise ValueError("DEBUG must be false in production")
            if "*" in self.cors_origins:
                raise ValueError("CORS_ORIGINS must be explicit in production")
        return self

    @property
    def dsn(self) -> str:
        pwd = self.postgres_password.get_secret_value()
        return (
            f"postgresql://{self.postgres_user}:{pwd}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings: Annotated[Settings, "process-wide singleton"] = get_settings()
