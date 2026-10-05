import hashlib
import json
import uuid
from collections import defaultdict
from datetime import UTC, datetime, time, timedelta

from app.models.budget import (
    BudgetCategoryProgress,
    BudgetCreate,
    BudgetPatch,
    BudgetRecord,
    BudgetStatus,
    BudgetStatusPage,
)
from app.models.transaction import TransactionFilters
from app.budget_repository import BudgetRepository, VersionConflict
from app.transaction_repository import TransactionRepository


class BudgetService:
    def __init__(self, budgets: BudgetRepository, transactions: TransactionRepository):
        self.budgets = budgets
        self.transactions = transactions

    def create(self, owner_id: str, payload: BudgetCreate, idempotency_key: str) -> BudgetRecord:
        now = datetime.now(UTC)
        record = BudgetRecord(
            budget_id=str(uuid.uuid4()),
            **payload.model_dump(),
            created_at=now,
            updated_at=now,
            version=1,
        )
        canonical = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        payload_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return self.budgets.create(owner_id, record, idempotency_key, payload_hash)

    def get(self, owner_id: str, budget_id: str) -> BudgetStatus:
        return self._status(owner_id, self.budgets.get(owner_id, budget_id))

    def list(self, owner_id: str) -> BudgetStatusPage:
        return BudgetStatusPage(items=[self._status(owner_id, budget) for budget in self.budgets.list(owner_id)])

    def update(self, owner_id: str, budget_id: str, patch: BudgetPatch) -> BudgetRecord:
        current = self.budgets.get(owner_id, budget_id)
        if current.version != patch.expected_version:
            raise VersionConflict
        changes = patch.model_dump(exclude={"expected_version"}, exclude_unset=True)
        for field in ("name", "category_limits", "alert_threshold_percent"):
            if changes.get(field) is None:
                changes.pop(field, None)
        if not changes:
            raise ValueError("Provide a non-null field to update")
        merged = current.model_dump(exclude={"budget_id", "created_at", "updated_at", "version"})
        merged.update(changes)
        # Revalidate cross-field constraints after applying a partial update.
        BudgetCreate.model_validate(merged)
        updated = current.model_copy(update={**changes, "updated_at": datetime.now(UTC), "version": current.version + 1})
        return self.budgets.update(owner_id, updated, patch.expected_version)

    def delete(self, owner_id: str, budget_id: str, expected_version: int) -> None:
        self.budgets.delete(owner_id, budget_id, expected_version)

    def _status(self, owner_id: str, budget: BudgetRecord) -> BudgetStatus:
        start_at = datetime.combine(budget.start_date, time.min, tzinfo=UTC)
        end_before = datetime.combine(budget.end_date + timedelta(days=1), time.min, tzinfo=UTC)
        filters = TransactionFilters(start_at=start_at, end_before=end_before, kind="expense", currency=budget.currency, limit=100)
        cursor: str | None = None
        spent_by_category: dict[str, int] = defaultdict(int)
        while True:
            page, cursor = self.transactions.list(owner_id, filters.model_copy(update={"cursor": cursor}))
            for transaction in page:
                spent_by_category[transaction.category] += transaction.amount_minor
            if cursor is None:
                break

        progress: list[BudgetCategoryProgress] = []
        if budget.total_limit_minor is not None:
            total_spent = sum(spent_by_category.values())
            progress.append(self._category_progress("all spending", budget.total_limit_minor, total_spent, budget.alert_threshold_percent))
        for category, limit in sorted(budget.category_limits.items()):
            progress.append(self._category_progress(category, limit, spent_by_category[category], budget.alert_threshold_percent))
        return BudgetStatus(
            budget_id=budget.budget_id,
            name=budget.name,
            period_type=budget.period_type,
            start_date=budget.start_date,
            end_date=budget.end_date,
            currency=budget.currency,
            total_limit_minor=budget.total_limit_minor,
            category_limits=budget.category_limits,
            alert_threshold_percent=budget.alert_threshold_percent,
            version=budget.version,
            categories=progress,
        )

    @staticmethod
    def _category_progress(category: str, limit: int, spent: int, threshold: int) -> BudgetCategoryProgress:
        return BudgetCategoryProgress(
            category=category,
            limit_minor=limit,
            spent_minor=spent,
            remaining_minor=limit - spent,
            percent_used=spent * 100 // limit,
            threshold_reached=spent * 100 >= limit * threshold,
        )
