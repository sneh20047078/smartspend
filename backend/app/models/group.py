from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from app.money import SUPPORTED_CURRENCIES

GroupSplitType = Literal["equal", "custom"]


def _normalize_member(value: str) -> str:
    normalized = value.strip().casefold()
    if not normalized:
        raise ValueError("Group member identifiers cannot be blank")
    return normalized


class GroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    currency: str = Field(min_length=3, max_length=3)
    members: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Group name cannot be blank")
        return normalized

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in SUPPORTED_CURRENCIES:
            raise ValueError("Currency is not currently supported")
        return normalized

    @field_validator("members")
    @classmethod
    def normalize_members(cls, value: list[str]) -> list[str]:
        if len(value) < 2:
            raise ValueError("A group must include at least two members")
        if len(value) > 25:
            raise ValueError("A group can contain at most 25 members")
        cleaned: list[str] = []
        seen: set[str] = set()
        for member in value:
            normalized = _normalize_member(member)
            if normalized in seen:
                continue
            cleaned.append(normalized)
            seen.add(normalized)
        if len(cleaned) < 2:
            raise ValueError("A group must include at least two unique members")
        return cleaned


class GroupPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1, strict=True)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    members: list[str] | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Group name cannot be blank")
        return normalized

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("members")
    @classmethod
    def normalize_members(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        if len(value) < 2:
            raise ValueError("A group must include at least two members")
        if len(value) > 25:
            raise ValueError("A group can contain at most 25 members")
        cleaned: list[str] = []
        seen: set[str] = set()
        for member in value:
            normalized = _normalize_member(member)
            if normalized in seen:
                continue
            cleaned.append(normalized)
            seen.add(normalized)
        if len(cleaned) < 2:
            raise ValueError("A group must include at least two unique members")
        return cleaned

    @model_validator(mode="after")
    def require_update(self):
        if not self.model_dump(exclude={"expected_version"}, exclude_unset=True):
            raise ValueError("At least one group field must be updated")
        return self


class GroupRecord(BaseModel):
    group_id: str
    name: str
    description: str | None = None
    currency: str
    members: list[str]
    created_at: datetime
    updated_at: datetime
    version: int = Field(ge=1)


class GroupExpenseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(min_length=1, max_length=120)
    amount_minor: int = Field(gt=0, le=9_000_000_000_000, strict=True)
    currency: str = Field(min_length=3, max_length=3)
    paid_by: str = Field(min_length=1, max_length=200)
    split_type: GroupSplitType = "equal"
    splits: dict[str, StrictInt] | None = None
    occurred_at: datetime

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Expense description cannot be blank")
        return normalized

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in SUPPORTED_CURRENCIES:
            raise ValueError("Currency is not currently supported")
        return normalized

    @field_validator("paid_by")
    @classmethod
    def normalize_paid_by(cls, value: str) -> str:
        return _normalize_member(value)

    @field_validator("splits")
    @classmethod
    def normalize_splits(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        if value is None:
            return None
        normalized: dict[str, int] = {}
        for member, share in value.items():
            key = _normalize_member(member)
            if isinstance(share, bool) or not isinstance(share, int) or share <= 0:
                raise ValueError("Custom split amounts must be positive integer minor units")
            normalized[key] = share
        return normalized

    @field_validator("occurred_at")
    @classmethod
    def normalize_occurred_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Expense date must include a timezone offset")
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def validate_split(self):
        if self.split_type == "custom":
            if not self.splits:
                raise ValueError("Custom split expenses require a split map")
            total = sum(self.splits.values())
            if total != self.amount_minor:
                raise ValueError("Custom split values must add up to the total amount")
        return self


class GroupExpenseRecord(BaseModel):
    expense_id: str
    group_id: str
    description: str
    amount_minor: int
    currency: str
    paid_by: str
    split_type: GroupSplitType
    splits: dict[str, int]
    occurred_at: datetime
    created_at: datetime
    updated_at: datetime
    version: int = Field(ge=1)


class GroupBalance(BaseModel):
    member_id: str
    net_minor: int


class GroupSettlement(BaseModel):
    from_member: str
    to_member: str
    amount_minor: int


class GroupSettlementSummary(BaseModel):
    group_id: str
    currency: str
    members: list[str]
    balances: list[GroupBalance]
    settlements: list[GroupSettlement]
    expenses: list[GroupExpenseRecord]
