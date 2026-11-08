from calendar import monthrange
from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.money import SUPPORTED_CURRENCIES

RecurrenceFrequency = Literal["weekly", "monthly"]
RecurrencePaymentMethod = Literal["cash", "card", "bank_transfer", "other"]


def next_occurrence(day: date, frequency: RecurrenceFrequency, interval: int, monthly_day: int | None = None) -> date:
    if frequency == "weekly":
        from datetime import timedelta

        return day + timedelta(weeks=interval)
    month_index = day.year * 12 + day.month - 1 + interval
    year, month_zero_based = divmod(month_index, 12)
    month = month_zero_based + 1
    target_day = monthly_day if monthly_day is not None else day.day
    return date(year, month, min(target_day, monthrange(year, month)[1]))


class RecurrenceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(min_length=1, max_length=120)
    amount_minor: int = Field(gt=0, le=9_000_000_000_000, strict=True)
    currency: str = Field(min_length=3, max_length=3)
    category: str = Field(min_length=1, max_length=40)
    notes: str | None = Field(default=None, max_length=500)
    payment_method: RecurrencePaymentMethod | None = None
    frequency: RecurrenceFrequency
    interval: int = Field(default=1, ge=1, le=52, strict=True)
    starts_on: date
    ends_on: date | None = None

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Description cannot be blank")
        return normalized

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in SUPPORTED_CURRENCIES:
            raise ValueError("Currency is not currently supported")
        return normalized

    @field_validator("category")
    @classmethod
    def normalize_category(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if not normalized:
            raise ValueError("Category cannot be blank")
        return normalized

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.ends_on is not None and self.ends_on < self.starts_on:
            raise ValueError("ends_on must be on or after starts_on")
        if self.frequency == "monthly" and self.interval > 12:
            raise ValueError("Monthly interval must be between 1 and 12")
        return self


class RecurrencePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1, strict=True)
    enabled: bool


class RecurringSchedule(BaseModel):
    schedule_id: str
    description: str
    amount_minor: int
    currency: str
    category: str
    notes: str | None = None
    payment_method: RecurrencePaymentMethod | None = None
    frequency: RecurrenceFrequency
    interval: int
    starts_on: date
    ends_on: date | None = None
    next_occurrence_on: date
    enabled: bool = True
    created_at: datetime
    updated_at: datetime
    version: int = Field(ge=1)

    @field_validator("created_at", "updated_at")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Timestamps must include a timezone offset")
        return value.astimezone(UTC)


class RecurrenceProcessResult(BaseModel):
    generated_count: int = Field(ge=0)
