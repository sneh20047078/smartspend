from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.money import SUPPORTED_CURRENCIES

TransactionKind = Literal["income", "expense"]
PaymentMethod = Literal["cash", "card", "bank_transfer", "other"]


class TransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: TransactionKind
    amount_minor: int = Field(gt=0, le=9_000_000_000_000, strict=True)
    currency: str = Field(min_length=3, max_length=3)
    category: str = Field(min_length=1, max_length=40)
    occurred_at: datetime
    notes: str | None = Field(default=None, max_length=500)
    payment_method: PaymentMethod | None = None

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

    @field_validator("occurred_at")
    @classmethod
    def normalize_occurred_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Transaction date must include a timezone offset")
        return value.astimezone(UTC)

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None


class TransactionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1, strict=True)
    kind: TransactionKind | None = None
    amount_minor: int | None = Field(default=None, gt=0, le=9_000_000_000_000, strict=True)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    category: str | None = Field(default=None, min_length=1, max_length=40)
    occurred_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=500)
    payment_method: PaymentMethod | None = None

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.upper()
        if normalized not in SUPPORTED_CURRENCIES:
            raise ValueError("Currency is not currently supported")
        return normalized

    @field_validator("category")
    @classmethod
    def normalize_category(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().casefold()
        if not normalized:
            raise ValueError("Category cannot be blank")
        return normalized

    @field_validator("occurred_at")
    @classmethod
    def normalize_occurred_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Transaction date must include a timezone offset")
        return value.astimezone(UTC)

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @model_validator(mode="after")
    def require_mutable_change(self):
        mutable = self.model_dump(exclude={"expected_version"}, exclude_unset=True)
        if not mutable:
            raise ValueError("At least one transaction field must be updated")
        return self


class TransactionRecord(BaseModel):
    transaction_id: str
    kind: TransactionKind
    amount_minor: int
    currency: str
    category: str
    occurred_at: datetime
    notes: str | None = None
    payment_method: PaymentMethod | None = None
    created_at: datetime
    updated_at: datetime
    version: int = Field(ge=1)


class TransactionPage(BaseModel):
    items: list[TransactionRecord]
    next_cursor: str | None = None


class TransactionFilters(BaseModel):
    start_at: datetime | None = None
    end_before: datetime | None = None
    kind: TransactionKind | None = None
    currency: str | None = None
    category: str | None = None
    search: str | None = None
    cursor: str | None = None
    limit: int = Field(default=25, ge=1, le=100)

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.upper()
        if normalized not in SUPPORTED_CURRENCIES:
            raise ValueError("Currency is not currently supported")
        return normalized

    @field_validator("category")
    @classmethod
    def normalize_category(cls, value: str | None) -> str | None:
        return value.strip().casefold() if value else None

    @field_validator("search")
    @classmethod
    def normalize_search(cls, value: str | None) -> str | None:
        normalized = value.strip().casefold() if value else None
        return normalized or None

    @model_validator(mode="after")
    def validate_range(self):
        if self.start_at is not None and self.end_before is not None and self.start_at >= self.end_before:
            raise ValueError("Start date must be before end date")
        return self


class CurrencyTotals(BaseModel):
    currency: str
    income_minor: int
    expense_minor: int
    balance_minor: int


class CategoryTotals(BaseModel):
    currency: str
    category: str
    expense_minor: int


class MonthlyTrend(BaseModel):
    month: str
    currency: str
    income_minor: int
    expense_minor: int


class DashboardSummary(BaseModel):
    range_start: date
    range_end: date
    timezone: str = "UTC"
    currencies: list[CurrencyTotals]
    category_totals: list[CategoryTotals]
    monthly_trend: list[MonthlyTrend]
    recent_transactions: list[TransactionRecord]
