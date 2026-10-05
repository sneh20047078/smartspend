from calendar import monthrange
from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from app.money import SUPPORTED_CURRENCIES

BudgetPeriodType = Literal["monthly", "custom"]
MAX_LIMIT_MINOR = 9_000_000_000_000


def _normalize_limits(value: dict[str, int]) -> dict[str, int]:
    if len(value) > 20:
        raise ValueError("A budget can contain at most 20 category limits")
    normalized: dict[str, int] = {}
    for category, limit in value.items():
        name = category.strip().casefold()
        if not name or len(name) > 40:
            raise ValueError("Budget category names must contain 1–40 characters")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 0 < limit <= MAX_LIMIT_MINOR:
            raise ValueError("Category limits must be positive integer minor units")
        normalized[name] = limit
    return normalized


class BudgetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    period_type: BudgetPeriodType
    start_date: date
    end_date: date
    currency: str = Field(min_length=3, max_length=3)
    total_limit_minor: int | None = Field(default=None, gt=0, le=MAX_LIMIT_MINOR, strict=True)
    category_limits: dict[str, StrictInt] = Field(default_factory=dict)
    alert_threshold_percent: int = Field(default=80, ge=50, le=100, strict=True)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Budget name cannot be blank")
        return normalized

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in SUPPORTED_CURRENCIES:
            raise ValueError("Currency is not currently supported")
        return normalized

    @field_validator("category_limits")
    @classmethod
    def normalize_category_limits(cls, value: dict[str, int]) -> dict[str, int]:
        return _normalize_limits(value)

    @model_validator(mode="after")
    def validate_period_and_limits(self):
        if self.end_date < self.start_date:
            raise ValueError("Budget end date must be on or after the start date")
        if (self.end_date - self.start_date).days > 365:
            raise ValueError("A budget period cannot exceed 366 days")
        if self.period_type == "monthly":
            last_day = monthrange(self.start_date.year, self.start_date.month)[1]
            if self.start_date.day != 1 or (self.end_date.year, self.end_date.month, self.end_date.day) != (self.start_date.year, self.start_date.month, last_day):
                raise ValueError("Monthly budgets must cover one complete calendar month")
        if self.total_limit_minor is None and not self.category_limits:
            raise ValueError("Provide an overall limit, one or more category limits, or both")
        return self


class BudgetPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1, strict=True)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    total_limit_minor: int | None = Field(default=None, gt=0, le=MAX_LIMIT_MINOR, strict=True)
    category_limits: dict[str, StrictInt] | None = None
    alert_threshold_percent: int | None = Field(default=None, ge=50, le=100, strict=True)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Budget name cannot be blank")
        return normalized

    @field_validator("category_limits")
    @classmethod
    def normalize_category_limits(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        return None if value is None else _normalize_limits(value)

    @model_validator(mode="after")
    def require_update(self):
        if not self.model_dump(exclude={"expected_version"}, exclude_unset=True):
            raise ValueError("At least one budget field must be updated")
        return self


class BudgetRecord(BaseModel):
    budget_id: str
    name: str
    period_type: BudgetPeriodType
    start_date: date
    end_date: date
    currency: str
    total_limit_minor: int | None = None
    category_limits: dict[str, int]
    alert_threshold_percent: int
    created_at: datetime
    updated_at: datetime
    version: int = Field(ge=1)


class BudgetCategoryProgress(BaseModel):
    category: str
    limit_minor: int
    spent_minor: int
    remaining_minor: int
    percent_used: int
    threshold_reached: bool


class BudgetStatus(BaseModel):
    budget_id: str
    name: str
    period_type: BudgetPeriodType
    start_date: date
    end_date: date
    currency: str
    total_limit_minor: int | None
    category_limits: dict[str, int]
    alert_threshold_percent: int
    version: int
    categories: list[BudgetCategoryProgress]


class BudgetStatusPage(BaseModel):
    items: list[BudgetStatus]
