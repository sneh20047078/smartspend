import hashlib
import json
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta

from app.models.transaction import (
    CategoryTotals,
    CurrencyTotals,
    DashboardSummary,
    MonthlyTrend,
    TransactionCreate,
    TransactionFilters,
    TransactionPage,
    TransactionPatch,
    TransactionRecord,
)
from app.transaction_repository import TransactionRepository, VersionConflict


class TransactionService:
    def __init__(self, repository: TransactionRepository):
        self.repository = repository

    def create(self, owner_id: str, payload: TransactionCreate, idempotency_key: str) -> TransactionRecord:
        now = datetime.now(UTC)
        record = TransactionRecord(
            transaction_id=str(uuid.uuid4()),
            **payload.model_dump(),
            created_at=now,
            updated_at=now,
            version=1,
        )
        canonical = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        payload_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return self.repository.create(owner_id, record, idempotency_key, payload_hash)

    def get(self, owner_id: str, transaction_id: str) -> TransactionRecord:
        return self.repository.get(owner_id, transaction_id)

    def list(self, owner_id: str, filters: TransactionFilters) -> TransactionPage:
        items, next_cursor = self.repository.list(owner_id, filters)
        return TransactionPage(items=items, next_cursor=next_cursor)

    def update(self, owner_id: str, transaction_id: str, patch: TransactionPatch) -> TransactionRecord:
        current = self.repository.get(owner_id, transaction_id)
        if current.version != patch.expected_version:
            raise VersionConflict
        changes = patch.model_dump(exclude={"expected_version"}, exclude_unset=True)
        for required in ("kind", "amount_minor", "currency", "category", "occurred_at"):
            if required in changes and changes[required] is None:
                raise ValueError(f"{required} cannot be null")
        updated = current.model_copy(update={**changes, "updated_at": datetime.now(UTC), "version": current.version + 1})
        return self.repository.update(owner_id, updated, patch.expected_version)

    def delete(self, owner_id: str, transaction_id: str, expected_version: int) -> None:
        self.repository.delete(owner_id, transaction_id, expected_version)

    def dashboard(
        self,
        owner_id: str,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> DashboardSummary:
        if (start_date is None) != (end_date is None):
            raise ValueError("Provide both start_date and end_date, or neither")
        today = datetime.now(UTC).date()
        if start_date is None:
            start_date = today.replace(day=1)
            end_date = today
        assert end_date is not None
        if end_date < start_date:
            raise ValueError("end_date must be on or after start_date")
        if (end_date - start_date).days > 365:
            raise ValueError("Dashboard date range cannot exceed 366 days")

        filters = TransactionFilters(
            start_at=datetime.combine(start_date, time.min, tzinfo=UTC),
            end_before=datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=UTC),
            limit=100,
        )
        totals: dict[str, dict[str, int]] = defaultdict(lambda: {"income": 0, "expense": 0})
        categories: dict[tuple[str, str], int] = defaultdict(int)
        months: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: {"income": 0, "expense": 0})
        recent: list[TransactionRecord] = []
        cursor: str | None = None
        while True:
            page_filters = filters.model_copy(update={"cursor": cursor})
            page, cursor = self.repository.list(owner_id, page_filters)
            if not recent:
                recent = page[:5]
            for item in page:
                totals[item.currency][item.kind] += item.amount_minor
                if item.kind == "expense":
                    categories[(item.currency, item.category)] += item.amount_minor
                month_key = item.occurred_at.strftime("%Y-%m")
                months[(item.currency, month_key)][item.kind] += item.amount_minor
            if cursor is None:
                break

        currency_totals = [
            CurrencyTotals(
                currency=currency,
                income_minor=amounts["income"],
                expense_minor=amounts["expense"],
                balance_minor=amounts["income"] - amounts["expense"],
            )
            for currency, amounts in sorted(totals.items())
        ]
        category_totals = [
            CategoryTotals(currency=currency, category=category, expense_minor=amount)
            for (currency, category), amount in sorted(categories.items(), key=lambda entry: (entry[0][0], -entry[1], entry[0][1]))
        ]
        month_keys = _months_between(start_date, end_date)
        monthly_trend = [
            MonthlyTrend(
                month=month,
                currency=currency,
                income_minor=months[(currency, month)]["income"],
                expense_minor=months[(currency, month)]["expense"],
            )
            for currency in sorted(totals)
            for month in month_keys
        ]
        return DashboardSummary(
            range_start=start_date,
            range_end=end_date,
            currencies=currency_totals,
            category_totals=category_totals,
            monthly_trend=monthly_trend,
            recent_transactions=recent,
        )


def _months_between(start: date, end: date) -> list[str]:
    months: list[str] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append(f"{year:04d}-{month:02d}")
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return months
