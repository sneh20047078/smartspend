import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Generator, Protocol

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from app.config import Settings
from app.models.recurrence import RecurringSchedule
from app.transaction_repository import IDEMPOTENCY_RETENTION_SECONDS, IdempotencyConflict, VersionConflict


class RecurrenceRepository(Protocol):
    def create(self, owner_id: str, record: RecurringSchedule, key: str, payload_hash: str) -> RecurringSchedule: ...
    def get(self, owner_id: str, schedule_id: str) -> RecurringSchedule: ...
    def list(self, owner_id: str) -> list[RecurringSchedule]: ...
    def update(self, owner_id: str, record: RecurringSchedule, expected_version: int) -> RecurringSchedule: ...
    def delete(self, owner_id: str, schedule_id: str, expected_version: int) -> None: ...


def _datetime(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _sqlite_record(row: sqlite3.Row) -> RecurringSchedule:
    values = dict(row)
    for field in ("starts_on", "ends_on", "next_occurrence_on"):
        if values[field] is not None:
            values[field] = datetime.strptime(values[field], "%Y-%m-%d").date()
    for field in ("created_at", "updated_at"):
        values[field] = _datetime(values[field])
    values["enabled"] = bool(values["enabled"])
    return RecurringSchedule.model_validate(values)


def _record_values(record: RecurringSchedule) -> tuple:
    return (
        record.schedule_id, record.description, record.amount_minor, record.currency,
        record.category, record.notes, record.payment_method, record.frequency,
        record.interval, record.starts_on.isoformat(), record.ends_on.isoformat() if record.ends_on else None,
        record.next_occurrence_on.isoformat(), int(record.enabled), record.created_at.isoformat(),
        record.updated_at.isoformat(), record.version,
    )


class SQLiteRecurrenceRepository:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS recurring_schedules (
                    owner_id TEXT NOT NULL,
                    schedule_id TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
                    currency TEXT NOT NULL,
                    category TEXT NOT NULL,
                    notes TEXT,
                    payment_method TEXT,
                    frequency TEXT NOT NULL,
                    interval INTEGER NOT NULL CHECK(interval > 0),
                    starts_on TEXT NOT NULL,
                    ends_on TEXT,
                    next_occurrence_on TEXT NOT NULL,
                    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    version INTEGER NOT NULL CHECK(version > 0),
                    PRIMARY KEY(owner_id, schedule_id)
                );
                CREATE INDEX IF NOT EXISTS recurring_owner_next
                    ON recurring_schedules(owner_id, enabled, next_occurrence_on);
                CREATE TABLE IF NOT EXISTS recurrence_idempotency (
                    owner_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    schedule_id TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    PRIMARY KEY(owner_id, idempotency_key)
                );
            """)

    @contextmanager
    def _connection(self) -> Generator[sqlite3.Connection, None, None]:
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _get(connection: sqlite3.Connection, owner_id: str, schedule_id: str) -> sqlite3.Row | None:
        return connection.execute(
            "SELECT * FROM recurring_schedules WHERE owner_id=? AND schedule_id=?",
            (owner_id, schedule_id),
        ).fetchone()

    def create(self, owner_id: str, record: RecurringSchedule, key: str, payload_hash: str) -> RecurringSchedule:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            connection.execute("DELETE FROM recurrence_idempotency WHERE owner_id=? AND expires_at<?", (owner_id, now))
            existing = connection.execute(
                "SELECT schedule_id,payload_hash FROM recurrence_idempotency WHERE owner_id=? AND idempotency_key=?",
                (owner_id, key),
            ).fetchone()
            if existing is not None:
                if existing["payload_hash"] != payload_hash:
                    raise IdempotencyConflict
                row = self._get(connection, owner_id, existing["schedule_id"])
                if row is None:
                    raise IdempotencyConflict
                return _sqlite_record(row)
            connection.execute(
                "INSERT INTO recurrence_idempotency(owner_id,idempotency_key,schedule_id,payload_hash,expires_at) VALUES(?,?,?,?,?)",
                (owner_id, key, record.schedule_id, payload_hash, now + IDEMPOTENCY_RETENTION_SECONDS),
            )
            connection.execute(
                "INSERT INTO recurring_schedules(owner_id,schedule_id,description,amount_minor,currency,category,notes,payment_method,frequency,interval,starts_on,ends_on,next_occurrence_on,enabled,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (owner_id, *_record_values(record)),
            )
        return record

    def get(self, owner_id: str, schedule_id: str) -> RecurringSchedule:
        with self._connection() as connection:
            row = self._get(connection, owner_id, schedule_id)
        if row is None:
            raise KeyError(schedule_id)
        return _sqlite_record(row)

    def list(self, owner_id: str) -> list[RecurringSchedule]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM recurring_schedules WHERE owner_id=? ORDER BY enabled DESC,next_occurrence_on,schedule_id",
                (owner_id,),
            ).fetchall()
        return [_sqlite_record(row) for row in rows]

    def update(self, owner_id: str, record: RecurringSchedule, expected_version: int) -> RecurringSchedule:
        values = _record_values(record)
        with self._connection() as connection:
            result = connection.execute(
                "UPDATE recurring_schedules SET description=?,amount_minor=?,currency=?,category=?,notes=?,payment_method=?,frequency=?,interval=?,starts_on=?,ends_on=?,next_occurrence_on=?,enabled=?,created_at=?,updated_at=?,version=? WHERE owner_id=? AND schedule_id=? AND version=?",
                (*values[1:], owner_id, record.schedule_id, expected_version),
            )
            if result.rowcount != 1:
                if self._get(connection, owner_id, record.schedule_id) is None:
                    raise KeyError(record.schedule_id)
                raise VersionConflict
        return record

    def delete(self, owner_id: str, schedule_id: str, expected_version: int) -> None:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            schedule = self._get(connection, owner_id, schedule_id)
            if schedule is None:
                raise KeyError(schedule_id)
            if schedule["version"] != expected_version:
                raise VersionConflict
            result = connection.execute(
                "DELETE FROM recurring_schedules WHERE owner_id=? AND schedule_id=? AND version=?",
                (owner_id, schedule_id, expected_version),
            )
            if result.rowcount != 1:
                raise VersionConflict


class DynamoDBRecurrenceRepository:
    def __init__(self, table_name: str, idempotency_table: str, region: str):
        self.dynamodb = boto3.resource("dynamodb", region_name=region)
        self.table_name = table_name
        self.idempotency_table_name = idempotency_table
        self.table = self.dynamodb.Table(table_name)
        self.idempotency = self.dynamodb.Table(idempotency_table)
        self.client = self.dynamodb.meta.client
        self.serializer = TypeSerializer()

    def _serialize(self, item: dict) -> dict:
        return {key: self.serializer.serialize(value) for key, value in item.items() if value is not None}

    @staticmethod
    def _record(item: dict) -> RecurringSchedule:
        values = dict(item)
        values.pop("owner_id", None)
        return RecurringSchedule.model_validate(values)

    def create(self, owner_id: str, record: RecurringSchedule, key: str, payload_hash: str) -> RecurringSchedule:
        item = record.model_dump(mode="json")
        item["owner_id"] = owner_id
        idem = {
            "owner_operation": f"{owner_id}#recurrences", "idempotency_key": key,
            "resource_type": "recurrence", "resource_id": record.schedule_id,
            "payload_hash": payload_hash, "expires_at": int(time.time()) + IDEMPOTENCY_RETENTION_SECONDS,
        }
        try:
            self.client.transact_write_items(TransactItems=[
                {"Put": {"TableName": self.table_name, "Item": self._serialize(item), "ConditionExpression": "attribute_not_exists(owner_id)"}},
                {"Put": {"TableName": self.idempotency_table_name, "Item": self._serialize(idem), "ConditionExpression": "attribute_not_exists(owner_operation) AND attribute_not_exists(idempotency_key)"}},
            ])
        except ClientError as exc:
            existing = self.idempotency.get_item(
                Key={"owner_operation": idem["owner_operation"], "idempotency_key": key},
                ConsistentRead=True,
            ).get("Item")
            if existing is not None:
                if existing.get("payload_hash") != payload_hash or existing.get("resource_type") != "recurrence":
                    raise IdempotencyConflict from exc
                try:
                    return self.get(owner_id, existing["resource_id"])
                except KeyError as missing:
                    raise IdempotencyConflict from missing
            raise
        return record

    def get(self, owner_id: str, schedule_id: str) -> RecurringSchedule:
        item = self.table.get_item(Key={"owner_id": owner_id, "schedule_id": schedule_id}, ConsistentRead=True).get("Item")
        if item is None:
            raise KeyError(schedule_id)
        return self._record(item)

    def list(self, owner_id: str) -> list[RecurringSchedule]:
        response = self.table.query(KeyConditionExpression=Key("owner_id").eq(owner_id), ConsistentRead=True)
        items = response.get("Items", [])
        while "LastEvaluatedKey" in response:
            response = self.table.query(
                KeyConditionExpression=Key("owner_id").eq(owner_id),
                ConsistentRead=True,
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            items.extend(response.get("Items", []))
        return sorted((self._record(item) for item in items), key=lambda record: (not record.enabled, record.next_occurrence_on, record.schedule_id))

    def update(self, owner_id: str, record: RecurringSchedule, expected_version: int) -> RecurringSchedule:
        fields = record.model_dump(mode="json", exclude={"schedule_id"})
        names = {f"#f{index}": field for index, field in enumerate(fields)}
        values = {f":v{index}": self.serializer.serialize(value) for index, value in enumerate(fields.values())}
        assignment = ", ".join(f"{name} = :v{index}" for index, name in enumerate(names))
        try:
            self.client.update_item(
                TableName=self.table_name,
                Key=self._serialize({"owner_id": owner_id, "schedule_id": record.schedule_id}),
                UpdateExpression=f"SET {assignment}",
                ConditionExpression="#version = :expected",
                ExpressionAttributeNames={**names, "#version": "version"},
                ExpressionAttributeValues={**values, ":expected": self.serializer.serialize(expected_version)},
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            try:
                self.get(owner_id, record.schedule_id)
            except KeyError as missing:
                raise missing
            raise VersionConflict from exc
        return record

    def delete(self, owner_id: str, schedule_id: str, expected_version: int) -> None:
        try:
            self.client.delete_item(
                TableName=self.table_name,
                Key=self._serialize({"owner_id": owner_id, "schedule_id": schedule_id}),
                ConditionExpression="#version = :expected",
                ExpressionAttributeNames={"#version": "version"},
                ExpressionAttributeValues={":expected": self.serializer.serialize(expected_version)},
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            try:
                self.get(owner_id, schedule_id)
            except KeyError as missing:
                raise missing
            raise VersionConflict from exc


def recurrence_payload_hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def create_recurrence_repository(settings: Settings) -> RecurrenceRepository:
    if settings.recurring_schedules_table and settings.idempotency_table:
        return DynamoDBRecurrenceRepository(settings.recurring_schedules_table, settings.idempotency_table, settings.aws_region)
    if settings.recurring_schedules_table:
        raise ValueError("The idempotency table must be configured with the recurring schedules table")
    if settings.app_env == "aws":
        raise ValueError("A DynamoDB recurring schedules table must be configured in AWS")
    return SQLiteRecurrenceRepository(settings.profile_db_path)
