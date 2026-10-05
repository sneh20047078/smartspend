from typing import Literal
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    preferred_currency: str | None = Field(default=None, min_length=3, max_length=3)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    theme: Literal["light", "dark", "system"] | None = None

    @field_validator("display_name")
    @classmethod
    def trim_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Display name cannot be blank")
        return value

    @field_validator("preferred_currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.upper()
        if re.fullmatch(r"[A-Z]{3}", value) is None:
            raise ValueError("Currency must be a three-letter ISO code")
        return value

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Unknown IANA timezone") from exc
        return value


class Profile(BaseModel):
    subject: str
    email: EmailStr
    display_name: str
    preferred_currency: str = "USD"
    timezone: str = "UTC"
    theme: Literal["light", "dark", "system"] = "system"


class ProfileView(BaseModel):
    email: EmailStr
    display_name: str
    preferred_currency: str
    timezone: str
    theme: Literal["light", "dark", "system"]
