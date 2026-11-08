from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / '.env'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

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
    groups_table: str = ""
    shared_expenses_table: str = ""
    recurring_schedules_table: str = ""

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
        origins = [origin.strip() for origin in self.api_cors_origins.split(",")]
        if self.app_env != "local":
            return origins

        loopback_aliases = []
        for origin in origins:
            if origin == "http://localhost" or origin.startswith("http://localhost:"):
                loopback_aliases.append(origin.replace("http://localhost", "http://127.0.0.1", 1))
            elif origin == "http://127.0.0.1" or origin.startswith("http://127.0.0.1:"):
                loopback_aliases.append(origin.replace("http://127.0.0.1", "http://localhost", 1))
        return list(dict.fromkeys([*origins, *loopback_aliases]))

    @model_validator(mode="after")
    def validate_aws_configuration(self):
        if self.app_env != "aws":
            return self
        required = {
            "COGNITO_USER_POOL_ID": self.cognito_user_pool_id,
            "COGNITO_APP_CLIENT_ID": self.cognito_app_client_id,
            "PROFILE_TABLE": self.profile_table,
            "TRANSACTIONS_TABLE": self.transactions_table,
            "BUDGETS_TABLE": self.budgets_table,
            "IDEMPOTENCY_TABLE": self.idempotency_table,
            "GROUPS_TABLE": self.groups_table,
            "SHARED_EXPENSES_TABLE": self.shared_expenses_table,
            "RECURRING_SCHEDULES_TABLE": self.recurring_schedules_table,
            "RECURRING_SCHEDULES_TABLE": self.recurring_schedules_table,
        }
        missing = [name for name, value in required.items() if not value.strip()]
        if missing:
            raise ValueError(f"AWS configuration is incomplete: {', '.join(missing)} must be configured")
        if any(not origin.lower().startswith("https://") for origin in self.cors_origin_list):
            raise ValueError("AWS CORS origins must use HTTPS")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
