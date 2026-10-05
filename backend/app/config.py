from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["local", "test", "aws"] = "local"
    api_cors_origins: str = "http://localhost:5173"
    smartspend_dev_jwt_secret: str = Field(default="", repr=False)
    smartspend_dev_token_minutes: int = Field(default=60, ge=5, le=1440)
    profile_db_path: str = "./smartspend-local.sqlite3"
    aws_region: str = Field(default="us-east-1", validation_alias="SMARTSPEND_AWS_REGION")
    cognito_user_pool_id: str = ""
    cognito_app_client_id: str = ""
    profile_table: str = ""
    transactions_table: str = ""
    idempotency_table: str = ""
    budgets_table: str = ""

    @field_validator("smartspend_dev_jwt_secret")
    @classmethod
    def validate_dev_secret(cls, value: str, info):
        env = info.data.get("app_env", "local")
        if env == "local" and value and len(value) < 32:
            raise ValueError("SMARTSPEND_DEV_JWT_SECRET must contain at least 32 characters")
        return value

    @field_validator("api_cors_origins")
    @classmethod
    def validate_origins(cls, value: str) -> str:
        origins = [origin.strip() for origin in value.split(",") if origin.strip()]
        if not origins or "*" in origins:
            raise ValueError("CORS origins must be explicit; wildcard origins are not allowed")
        return ",".join(origins)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()
