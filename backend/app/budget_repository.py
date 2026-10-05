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
from app.models.budget import BudgetRecord
from app.transaction_repository import IDEMPOTENCY_RETENTION_SECONDS, IdempotencyConflict, VersionConflict


class BudgetRepository(Protocol):
    def create(self, owner_id: str, record: BudgetRecord, key: str, payload_hash: str) -> BudgetRecord: ...
    def get(self, owner_id: str, budget_id: str) -> BudgetRecord: ...
    def list(self, owner_id: str) -> list[BudgetRecord]: ...
    def update(self, owner_id: str, record: BudgetRecord, expected_version: int) -> BudgetRecord: ...
    def delete(self, owner_id: str, budget_id: str, expected_version: int) -> None: ...


def _record_sql(row: sqlite3.Row) -> BudgetRecord:
    values = dict(row)
    values["category_limits"] = json.loads(values["category_limits"])
    values["created_at"] = datetime.fromisoformat(values["created_at"])
    values["updated_at"] = datetime.fromisoformat(values["updated_at"])
    return BudgetRecord.model_validate(values)


def _values(record: BudgetRecord) -> tuple:
    return (
        record.budget_id, record.name, record.period_type, record.start_date.isoformat(),
        record.end_date.isoformat(), record.currency, record.total_limit_minor,
        json.dumps(record.category_limits, sort_keys=True, separators=(",", ":")),
        record.alert_threshold_percent, record.created_at.isoformat(), record.updated_at.isoformat(), record.version,
    )


class SQLiteBudgetRepository:
    """SQLite local storage for owner-scoped budgets and retry keys."""

    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS budgets (
                    owner_id TEXT NOT NULL,
                    budget_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    period_type TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT NOT NULL,
                    currency TEXT NOT NULL,
                    total_limit_minor INTEGER,
                    category_limits TEXT NOT NULL,
                    alert_threshold_percent INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    version INTEGER NOT NULL CHECK (version > 0),
                    PRIMARY KEY(owner_id, budget_id)
                );
                CREATE INDEX IF NOT EXISTS budgets_owner_period ON budgets(owner_id, start_date DESC, end_date);
                CREATE TABLE IF NOT EXISTS budget_idempotency (
                    owner_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    budget_id TEXT NOT NULL,
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
    def _get_row(connection: sqlite3.Connection, owner_id: str, budget_id: str) -> sqlite3.Row | None:
        return connection.execute("SELECT * FROM budgets WHERE owner_id=? AND budget_id=?", (owner_id, budget_id)).fetchone()

    def create(self, owner_id: str, record: BudgetRecord, key: str, payload_hash: str) -> BudgetRecord:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            connection.execute("DELETE FROM budget_idempotency WHERE owner_id=? AND expires_at < ?", (owner_id, now))
            existing = connection.execute(
                "SELECT budget_id,payload_hash FROM budget_idempotency WHERE owner_id=? AND idempotency_key=?",
                (owner_id, key),
            ).fetchone()
            if existing is not None:
                if existing["payload_hash"] != payload_hash:
                    raise IdempotencyConflict
                row = self._get_row(connection, owner_id, existing["budget_id"])
                if row is None:
                    raise IdempotencyConflict
                return _record_sql(row)
            connection.execute(
                "INSERT INTO budget_idempotency(owner_id,idempotency_key,budget_id,payload_hash,expires_at) VALUES(?,?,?,?,?)",
                (owner_id, key, record.budget_id, payload_hash, now + IDEMPOTENCY_RETENTION_SECONDS),
            )
            connection.execute(
                "INSERT INTO budgets(budget_id,name,period_type,start_date,end_date,currency,total_limit_minor,category_limits,alert_threshold_percent,created_at,updated_at,version,owner_id) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (*_values(record), owner_id),
            )
        return record

    def get(self, owner_id: str, budget_id: str) -> BudgetRecord:
        with self._connection() as connection:
            row = self._get_row(connection, owner_id, budget_id)
        if row is None:
            raise KeyError(budget_id)
        return _record_sql(row)

    def list(self, owner_id: str) -> list[BudgetRecord]:
        with self._connection() as connection:
            rows = connection.execute("SELECT * FROM budgets WHERE owner_id=? ORDER BY start_date DESC, budget_id", (owner_id,)).fetchall()
        return [_record_sql(row) for row in rows]

    def update(self, owner_id: str, record: BudgetRecord, expected_version: int) -> BudgetRecord:
        values = _values(record)
        with self._connection() as connection:
            cursor = connection.execute(
                "UPDATE budgets SET name=?,period_type=?,start_date=?,end_date=?,currency=?,total_limit_minor=?,category_limits=?,alert_threshold_percent=?,created_at=?,updated_at=?,version=? WHERE owner_id=? AND budget_id=? AND version=?",
                (*values[1:], owner_id, record.budget_id, expected_version),
            )
            if cursor.rowcount != 1:
                if self._get_row(connection, owner_id, record.budget_id) is None:
                    raise KeyError(record.budget_id)
                raise VersionConflict
        return record

    def delete(self, owner_id: str, budget_id: str, expected_version: int) -> None:
        with self._connection() as connection:
            cursor = connection.execute("DELETE FROM budgets WHERE owner_id=? AND budget_id=? AND version=?", (owner_id, budget_id, expected_version))
            if cursor.rowcount != 1:
                if self._get_row(connection, owner_id, budget_id) is None:
                    raise KeyError(budget_id)
                raise VersionConflict


class DynamoDBBudgetRepository:
    """Owner-partitioned DynamoDB budget adapter with conditional writes."""

    def __init__(self, budget_table: str, idempotency_table: str, region: str):
        self.dynamodb = boto3.resource("dynamodb", region_name=region)
        self.budget_table_name = budget_table
        self.idempotency_table_name = idempotency_table
        self.budgets = self.dynamodb.Table(budget_table)
        self.idempotency = self.dynamodb.Table(idempotency_table)
        self.client = self.dynamodb.meta.client
        self.serializer = TypeSerializer()

    def _serialize(self, item: dict) -> dict:
        return {key: self.serializer.serialize(value) for key, value in item.items() if value is not None}

    @staticmethod
    def _record(item: dict) -> BudgetRecord:
        values = dict(item)
        values.pop("owner_id", None)
        return BudgetRecord.model_validate(values)

    def create(self, owner_id: str, record: BudgetRecord, key: str, payload_hash: str) -> BudgetRecord:
        item = record.model_dump(mode="json")
        item["owner_id"] = owner_id
        idempotency_item = {
            "owner_operation": f"{owner_id}#budgets", "idempotency_key": key,
            "resource_type": "budget", "resource_id": record.budget_id,
            "payload_hash": payload_hash, "expires_at": int(time.time()) + IDEMPOTENCY_RETENTION_SECONDS,
        }
        try:
            self.client.transact_write_items(TransactItems=[
                {"Put": {"TableName": self.budget_table_name, "Item": self._serialize(item), "ConditionExpression": "attribute_not_exists(budget_id)"}},
                {"Put": {"TableName": self.idempotency_table_name, "Item": self._serialize(idempotency_item), "ConditionExpression": "attribute_not_exists(owner_operation) AND attribute_not_exists(idempotency_key)"}},
            ])
        except ClientError as exc:
            existing = self.idempotency.get_item(Key={"owner_operation": idempotency_item["owner_operation"], "idempotency_key": key}, ConsistentRead=True).get("Item")
            if existing is not None:
                if existing.get("payload_hash") != payload_hash:
                    raise IdempotencyConflict from exc
                try:
                    return self.get(owner_id, existing["resource_id"])
                except KeyError as missing:
                    raise IdempotencyConflict from missing
            raise
        return record

    def get(self, owner_id: str, budget_id: str) -> BudgetRecord:
        item = self.budgets.get_item(Key={"owner_id": owner_id, "budget_id": budget_id}, ConsistentRead=True).get("Item")
        if item is None:
            raise KeyError(budget_id)
        return self._record(item)

    def list(self, owner_id: str) -> list[BudgetRecord]:
        response = self.budgets.query(KeyConditionExpression=Key("owner_id").eq(owner_id), ConsistentRead=True)
        items = response.get("Items", [])
        while "LastEvaluatedKey" in response:
            response = self.budgets.query(KeyConditionExpression=Key("owner_id").eq(owner_id), ConsistentRead=True, ExclusiveStartKey=response["LastEvaluatedKey"])
            items.extend(response.get("Items", []))
        records = [self._record(item) for item in items]
        return sorted(records, key=lambda record: (record.start_date, record.budget_id), reverse=True)

    def update(self, owner_id: str, record: BudgetRecord, expected_version: int) -> BudgetRecord:
        item = record.model_dump(mode="json")
        fields = {key: value for key, value in item.items() if key != "budget_id"}
        names = {f"#f{index}": key for index, key in enumerate(fields)}
        values = {f":v{index}": self.serializer.serialize(value) for index, value in enumerate(fields.values())}
        assignment = ", ".join(f"{name} = :v{index}" for index, name in enumerate(names))
        try:
            self.client.update_item(
                TableName=self.budget_table_name,
                Key=self._serialize({"owner_id": owner_id, "budget_id": record.budget_id}),
                UpdateExpression=f"SET {assignment}",
                ConditionExpression="#version = :expected",
                ExpressionAttributeNames={**names, "#version": "version"},
                ExpressionAttributeValues={**values, ":expected": self.serializer.serialize(expected_version)},
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            try:
                self.get(owner_id, record.budget_id)
            except KeyError as missing:
                raise missing
            raise VersionConflict from exc
        return record

    def delete(self, owner_id: str, budget_id: str, expected_version: int) -> None:
        try:
            self.client.delete_item(
                TableName=self.budget_table_name,
                Key=self._serialize({"owner_id": owner_id, "budget_id": budget_id}),
                ConditionExpression="#version = :expected",
                ExpressionAttributeNames={"#version": "version"},
                ExpressionAttributeValues={":expected": self.serializer.serialize(expected_version)},
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            try:
                self.get(owner_id, budget_id)
            except KeyError as missing:
                raise missing
            raise VersionConflict from exc


def create_budget_repository(settings: Settings) -> BudgetRepository:
    if settings.budgets_table and settings.idempotency_table:
        return DynamoDBBudgetRepository(settings.budgets_table, settings.idempotency_table, settings.aws_region)
    if settings.budgets_table:
        raise ValueError("The idempotency table must be configured with the budget table")
    if settings.app_env == "aws":
        raise ValueError("A DynamoDB budget table must be configured in AWS")
    return SQLiteBudgetRepository(settings.profile_db_path)
