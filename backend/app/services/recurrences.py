import hashlib
from datetime import UTC, date, datetime, time
import uuid

from app.models.recurrence import RecurrenceCreate, RecurrencePatch, RecurringSchedule, next_occurrence
from app.models.transaction import TransactionCreate
from app.recurrence_repository import RecurrenceRepository, recurrence_payload_hash
from app.services.transactions import TransactionService
from app.transaction_repository import IdempotencyConflict, VersionConflict


class RecurrenceService:
    def __init__(self, repository: RecurrenceRepository, transactions: TransactionService):
        self.repository = repository
        self.transactions = transactions

    def create(self, owner_id: str, payload: RecurrenceCreate, idempotency_key: str) -> RecurringSchedule:
        now = datetime.now(UTC)
        record = RecurringSchedule(
            schedule_id=str(uuid.uuid4()),
            **payload.model_dump(),
            next_occurrence_on=payload.starts_on,
            enabled=True,
            created_at=now,
            updated_at=now,
            version=1,
        )
        return self.repository.create(owner_id, record, idempotency_key, recurrence_payload_hash(payload.model_dump(mode="json")))

    def get(self, owner_id: str, schedule_id: str) -> RecurringSchedule:
        return self.repository.get(owner_id, schedule_id)

    def list(self, owner_id: str) -> list[RecurringSchedule]:
        return self.repository.list(owner_id)

    def set_enabled(self, owner_id: str, schedule_id: str, patch: RecurrencePatch) -> RecurringSchedule:
        current = self.repository.get(owner_id, schedule_id)
        if current.version != patch.expected_version:
            raise VersionConflict
        updated = current.model_copy(update={
            "enabled": patch.enabled,
            "updated_at": datetime.now(UTC),
            "version": current.version + 1,
        })
        return self.repository.update(owner_id, updated, patch.expected_version)

    def delete(self, owner_id: str, schedule_id: str, expected_version: int) -> None:
        self.repository.delete(owner_id, schedule_id, expected_version)

    def process_due(self, owner_id: str, today: date | None = None, max_occurrences_per_schedule: int = 100) -> int:
        as_of = today or datetime.now(UTC).date()
        generated = 0
        for schedule in self.repository.list(owner_id):
            if not schedule.enabled:
                continue
            next_day = schedule.next_occurrence_on
            processed = 0
            should_disable = False
            while next_day <= as_of and processed < max_occurrences_per_schedule:
                if schedule.ends_on is not None and next_day > schedule.ends_on:
                    break
                payload = TransactionCreate(
                    kind="expense",
                    amount_minor=schedule.amount_minor,
                    currency=schedule.currency,
                    category=schedule.category,
                    notes=schedule.notes,
                    payment_method=schedule.payment_method,
                    occurred_at=datetime.combine(next_day, time.min, tzinfo=UTC),
                )
                key = hashlib.sha256(f"recurrence:{schedule.schedule_id}:{next_day.isoformat()}".encode("utf-8")).hexdigest()
                try:
                    self.transactions.create(owner_id, payload, key)
                except IdempotencyConflict:
                    # A collision with a different transaction payload is surfaced; never skip a corrupt occurrence.
                    raise
                generated += 1
                processed += 1
                candidate = next_occurrence(next_day, schedule.frequency, schedule.interval, schedule.starts_on.day)
                if schedule.ends_on is not None and candidate > schedule.ends_on:
                    next_day = schedule.ends_on
                    should_disable = True
                    break
                next_day = candidate

            should_disable = should_disable or (schedule.ends_on is not None and next_day > schedule.ends_on)
            if processed or should_disable:
                updated = schedule.model_copy(update={
                    "next_occurrence_on": next_day,
                    "enabled": False if should_disable else schedule.enabled,
                    "updated_at": datetime.now(UTC),
                    "version": schedule.version + 1,
                })
                try:
                    self.repository.update(owner_id, updated, schedule.version)
                except VersionConflict:
                    # Concurrent reads are safe: transaction idempotency prevents duplicates and the winner advances the cursor.
                    pass
        return generated
