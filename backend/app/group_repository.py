from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Generator, Protocol

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from app.config import Settings
from app.models.group import GroupExpenseRecord, GroupRecord
from app.transaction_repository import IDEMPOTENCY_RETENTION_SECONDS, IdempotencyConflict, VersionConflict


class GroupRepository(Protocol):
    def create(self, owner_id: str, record: GroupRecord, key: str, payload_hash: str) -> GroupRecord: ...
    def get(self, owner_id: str, group_id: str) -> GroupRecord: ...
    def list(self, owner_id: str) -> list[GroupRecord]: ...
    def update(self, owner_id: str, record: GroupRecord, expected_version: int) -> GroupRecord: ...
    def delete(self, owner_id: str, group_id: str, expected_version: int) -> None: ...
    def create_expense(self, owner_id: str, group_id: str, record: GroupExpenseRecord, key: str, payload_hash: str) -> GroupExpenseRecord: ...
    def list_expenses(self, owner_id: str, group_id: str) -> list[GroupExpenseRecord]: ...


def _record_sql(row: sqlite3.Row) -> GroupRecord:
    values = dict(row)
    values["members"] = json.loads(values["members"])
    values["created_at"] = datetime.fromisoformat(values["created_at"])
    values["updated_at"] = datetime.fromisoformat(values["updated_at"])
    return GroupRecord.model_validate(values)


def _expense_record_sql(row: sqlite3.Row) -> GroupExpenseRecord:
    values = dict(row)
    values["splits"] = json.loads(values["splits"])
    values["occurred_at"] = datetime.fromisoformat(values["occurred_at"])
    values["created_at"] = datetime.fromisoformat(values["created_at"])
    values["updated_at"] = datetime.fromisoformat(values["updated_at"])
    return GroupExpenseRecord.model_validate(values)


def _group_values(record: GroupRecord) -> tuple:
    return (
        record.group_id,
        record.name,
        record.description,
        record.currency,
        json.dumps(record.members, separators=(",", ":"), sort_keys=False),
        record.created_at.isoformat(),
        record.updated_at.isoformat(),
        record.version,
    )


def _expense_values(record: GroupExpenseRecord) -> tuple:
    return (
        record.expense_id,
        record.description,
        record.amount_minor,
        record.currency,
        record.paid_by,
        record.split_type,
        json.dumps(record.splits, separators=(",", ":"), sort_keys=True),
        record.occurred_at.isoformat(),
        record.created_at.isoformat(),
        record.updated_at.isoformat(),
        record.version,
    )


class SQLiteGroupRepository:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS groups (
                    owner_id TEXT NOT NULL,
                    group_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    currency TEXT NOT NULL,
                    members TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    version INTEGER NOT NULL CHECK (version > 0),
                    PRIMARY KEY(owner_id, group_id)
                );
                CREATE TABLE IF NOT EXISTS group_idempotency (
                    owner_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    resource_type TEXT NOT NULL,
                    resource_id TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    PRIMARY KEY(owner_id, idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS group_expenses (
                    owner_id TEXT NOT NULL,
                    group_id TEXT NOT NULL,
                    expense_id TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount_minor INTEGER NOT NULL,
                    currency TEXT NOT NULL,
                    paid_by TEXT NOT NULL,
                    split_type TEXT NOT NULL,
                    splits TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    version INTEGER NOT NULL CHECK (version > 0),
                    PRIMARY KEY(owner_id, group_id, expense_id)
                );
                CREATE INDEX IF NOT EXISTS group_expenses_owner_group ON group_expenses(owner_id, group_id, occurred_at DESC, expense_id DESC);
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
    def _get_row(connection: sqlite3.Connection, owner_id: str, group_id: str) -> sqlite3.Row | None:
        return connection.execute(
            "SELECT * FROM groups WHERE owner_id=? AND group_id=?",
            (owner_id, group_id),
        ).fetchone()

    @staticmethod
    def _get_expense_row(connection: sqlite3.Connection, owner_id: str, group_id: str, expense_id: str) -> sqlite3.Row | None:
        return connection.execute(
            "SELECT * FROM group_expenses WHERE owner_id=? AND group_id=? AND expense_id=?",
            (owner_id, group_id, expense_id),
        ).fetchone()

    def create(self, owner_id: str, record: GroupRecord, key: str, payload_hash: str) -> GroupRecord:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            connection.execute("DELETE FROM group_idempotency WHERE owner_id=? AND expires_at < ?", (owner_id, now))
            existing = connection.execute(
                "SELECT resource_type, resource_id, payload_hash FROM group_idempotency WHERE owner_id=? AND idempotency_key=?",
                (owner_id, key),
            ).fetchone()
            if existing is not None:
                if existing["payload_hash"] != payload_hash:
                    raise IdempotencyConflict
                if existing["resource_type"] == "group":
                    row = self._get_row(connection, owner_id, existing["resource_id"])
                    if row is None:
                        raise IdempotencyConflict
                    return _record_sql(row)
                raise IdempotencyConflict
            connection.execute(
                "INSERT INTO group_idempotency(owner_id,idempotency_key,resource_type,resource_id,payload_hash,expires_at) VALUES(?,?,?,?,?,?)",
                (owner_id, key, "group", record.group_id, payload_hash, now + IDEMPOTENCY_RETENTION_SECONDS),
            )
            connection.execute(
                "INSERT INTO groups(owner_id,group_id,name,description,currency,members,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?)",
                (owner_id, *_group_values(record)),
            )
        return record

    def get(self, owner_id: str, group_id: str) -> GroupRecord:
        with self._connection() as connection:
            row = self._get_row(connection, owner_id, group_id)
        if row is None:
            raise KeyError(group_id)
        return _record_sql(row)

    def list(self, owner_id: str) -> list[GroupRecord]:
        with self._connection() as connection:
            rows = connection.execute("SELECT * FROM groups WHERE owner_id=? ORDER BY updated_at DESC, group_id", (owner_id,)).fetchall()
        return [_record_sql(row) for row in rows]

    def update(self, owner_id: str, record: GroupRecord, expected_version: int) -> GroupRecord:
        values = _group_values(record)
        with self._connection() as connection:
            cursor = connection.execute(
                "UPDATE groups SET name=?,description=?,currency=?,members=?,created_at=?,updated_at=?,version=? WHERE owner_id=? AND group_id=? AND version=?",
                (*values[1:], owner_id, record.group_id, expected_version),
            )
            if cursor.rowcount != 1:
                if self._get_row(connection, owner_id, record.group_id) is None:
                    raise KeyError(record.group_id)
                raise VersionConflict
        return record

    def delete(self, owner_id: str, group_id: str, expected_version: int) -> None:
        with self._connection() as connection:
            cursor = connection.execute(
                "DELETE FROM groups WHERE owner_id=? AND group_id=? AND version=?",
                (owner_id, group_id, expected_version),
            )
            if cursor.rowcount != 1:
                if self._get_row(connection, owner_id, group_id) is None:
                    raise KeyError(group_id)
                raise VersionConflict
            connection.execute("DELETE FROM group_expenses WHERE owner_id=? AND group_id=?", (owner_id, group_id))

    def create_expense(self, owner_id: str, group_id: str, record: GroupExpenseRecord, key: str, payload_hash: str) -> GroupExpenseRecord:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            connection.execute("DELETE FROM group_idempotency WHERE owner_id=? AND expires_at < ?", (owner_id, now))
            existing = connection.execute(
                "SELECT resource_type, resource_id, payload_hash FROM group_idempotency WHERE owner_id=? AND idempotency_key=?",
                (owner_id, key),
            ).fetchone()
            if existing is not None:
                if existing["payload_hash"] != payload_hash:
                    raise IdempotencyConflict
                if existing["resource_type"] == "expense":
                    row = self._get_expense_row(connection, owner_id, group_id, existing["resource_id"])
                    if row is None:
                        raise IdempotencyConflict
                    return _expense_record_sql(row)
                raise IdempotencyConflict
            connection.execute(
                "INSERT INTO group_idempotency(owner_id,idempotency_key,resource_type,resource_id,payload_hash,expires_at) VALUES(?,?,?,?,?,?)",
                (owner_id, key, "expense", record.expense_id, payload_hash, now + IDEMPOTENCY_RETENTION_SECONDS),
            )
            connection.execute(
                "INSERT INTO group_expenses(owner_id,group_id,expense_id,description,amount_minor,currency,paid_by,split_type,splits,occurred_at,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (owner_id, group_id, *_expense_values(record)),
            )
        return record

    def list_expenses(self, owner_id: str, group_id: str) -> list[GroupExpenseRecord]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM group_expenses WHERE owner_id=? AND group_id=? ORDER BY occurred_at DESC, expense_id DESC",
                (owner_id, group_id),
            ).fetchall()
        return [_expense_record_sql(row) for row in rows]


class DynamoDBGroupRepository:
    """Owner-partitioned DynamoDB group/expense storage with transactional idempotency."""

    def __init__(self, groups_table: str, expenses_table: str, idempotency_table: str, region: str):
        self.dynamodb = boto3.resource("dynamodb", region_name=region)
        self.groups_table_name = groups_table
        self.expenses_table_name = expenses_table
        self.idempotency_table_name = idempotency_table
        self.groups = self.dynamodb.Table(groups_table)
        self.expenses = self.dynamodb.Table(expenses_table)
        self.idempotency = self.dynamodb.Table(idempotency_table)
        self.client = self.dynamodb.meta.client
        self.serializer = TypeSerializer()

    def _serialize(self, item: dict) -> dict:
        return {key: self.serializer.serialize(value) for key, value in item.items() if value is not None}

    @staticmethod
    def _group_record(item: dict) -> GroupRecord:
        values = dict(item)
        values.pop("owner_id", None)
        return GroupRecord.model_validate(values)

    @staticmethod
    def _expense_record(item: dict) -> GroupExpenseRecord:
        values = dict(item)
        values.pop("owner_id", None)
        values.pop("group_sort_key", None)
        return GroupExpenseRecord.model_validate(values)

    @staticmethod
    def _expense_sort_key(group_id: str, record: GroupExpenseRecord) -> str:
        occurred_at = record.occurred_at.astimezone(UTC).isoformat(timespec="microseconds")
        return f"{group_id}#{occurred_at}#{record.expense_id}"

    def _existing_idempotent(self, owner_id: str, key: str, payload_hash: str, resource_type: str, group_id: str | None = None):
        owner_operation = f"{owner_id}#groups"
        item = self.idempotency.get_item(
            Key={"owner_operation": owner_operation, "idempotency_key": key},
            ConsistentRead=True,
        ).get("Item")
        if item is None:
            return None
        if item.get("payload_hash") != payload_hash or item.get("resource_type") != resource_type:
            raise IdempotencyConflict
        if resource_type == "group":
            try:
                return self.get(owner_id, item["resource_id"])
            except KeyError as exc:
                raise IdempotencyConflict from exc
        if item.get("group_id") != group_id:
            raise IdempotencyConflict
        record = self.expenses.get_item(
            Key={"owner_id": owner_id, "group_sort_key": item["group_sort_key"]},
            ConsistentRead=True,
        ).get("Item")
        if record is None:
            raise IdempotencyConflict
        return self._expense_record(record)

    def create(self, owner_id: str, record: GroupRecord, key: str, payload_hash: str) -> GroupRecord:
        item = record.model_dump(mode="json")
        item["owner_id"] = owner_id
        owner_operation = f"{owner_id}#groups"
        idempotency_item = {
            "owner_operation": owner_operation,
            "idempotency_key": key,
            "resource_type": "group",
            "resource_id": record.group_id,
            "payload_hash": payload_hash,
            "expires_at": int(time.time()) + IDEMPOTENCY_RETENTION_SECONDS,
        }
        try:
            self.client.transact_write_items(TransactItems=[
                {"Put": {"TableName": self.groups_table_name, "Item": self._serialize(item), "ConditionExpression": "attribute_not_exists(owner_id)"}},
                {"Put": {"TableName": self.idempotency_table_name, "Item": self._serialize(idempotency_item), "ConditionExpression": "attribute_not_exists(owner_operation) AND attribute_not_exists(idempotency_key)"}},
            ])
        except ClientError as exc:
            try:
                existing = self._existing_idempotent(owner_id, key, payload_hash, "group")
            except IdempotencyConflict:
                raise
            if existing is not None:
                return existing
            raise exc
        return record

    def get(self, owner_id: str, group_id: str) -> GroupRecord:
        item = self.groups.get_item(Key={"owner_id": owner_id, "group_id": group_id}, ConsistentRead=True).get("Item")
        if item is None or item.get("deleting") is True:
            raise KeyError(group_id)
        return self._group_record(item)

    def list(self, owner_id: str) -> list[GroupRecord]:
        response = self.groups.query(KeyConditionExpression=Key("owner_id").eq(owner_id), ConsistentRead=True)
        items = response.get("Items", [])
        while "LastEvaluatedKey" in response:
            response = self.groups.query(
                KeyConditionExpression=Key("owner_id").eq(owner_id),
                ConsistentRead=True,
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            items.extend(response.get("Items", []))
        records = [self._group_record(item) for item in items]
        return sorted(records, key=lambda group: (group.updated_at, group.group_id), reverse=True)

    def update(self, owner_id: str, record: GroupRecord, expected_version: int) -> GroupRecord:
        fields = record.model_dump(mode="json", exclude={"group_id"})
        names = {f"#f{index}": field for index, field in enumerate(fields)}
        values = {f":v{index}": self.serializer.serialize(value) for index, value in enumerate(fields.values())}
        assignment = ", ".join(f"{name} = :v{index}" for index, name in enumerate(names))
        try:
            self.client.update_item(
                TableName=self.groups_table_name,
                Key=self._serialize({"owner_id": owner_id, "group_id": record.group_id}),
                UpdateExpression=f"SET {assignment}",
                ConditionExpression="#version = :expected AND attribute_not_exists(#deleting)",
                ExpressionAttributeNames={**names, "#version": "version", "#deleting": "deleting"},
                ExpressionAttributeValues={**values, ":expected": self.serializer.serialize(expected_version)},
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            self.get(owner_id, record.group_id)
            raise VersionConflict from exc
        return record

    def delete(self, owner_id: str, group_id: str, expected_version: int) -> None:
        current = self.groups.get_item(Key={"owner_id": owner_id, "group_id": group_id}, ConsistentRead=True).get("Item")
        if current is None:
            raise KeyError(group_id)
        if current.get("version") != expected_version:
            raise VersionConflict

        if current.get("deleting") is not True:
            try:
                self.client.update_item(
                    TableName=self.groups_table_name,
                    Key=self._serialize({"owner_id": owner_id, "group_id": group_id}),
                    UpdateExpression="SET #deleting = :deleting",
                    ConditionExpression="#version = :expected AND attribute_not_exists(#deleting)",
                    ExpressionAttributeNames={"#version": "version", "#deleting": "deleting"},
                    ExpressionAttributeValues={
                        ":expected": self.serializer.serialize(expected_version),
                        ":deleting": self.serializer.serialize(True),
                    },
                )
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                    raise
                current = self.groups.get_item(Key={"owner_id": owner_id, "group_id": group_id}, ConsistentRead=True).get("Item")
                if current is None:
                    raise KeyError(group_id) from exc
                if current.get("version") != expected_version or current.get("deleting") is not True:
                    raise VersionConflict from exc

        # A durable tombstone prevents new expenses and lets a retry resume cleanup after a timeout.
        # Group expense reads require a non-deleting group, so marked data is no longer exposed.
        response = self.expenses.query(
            KeyConditionExpression=Key("owner_id").eq(owner_id) & Key("group_sort_key").begins_with(f"{group_id}#"),
            ConsistentRead=True,
            ProjectionExpression="owner_id, group_sort_key",
        )
        with self.expenses.batch_writer() as batch:
            for item in response.get("Items", []):
                batch.delete_item(Key={"owner_id": owner_id, "group_sort_key": item["group_sort_key"]})
            while "LastEvaluatedKey" in response:
                response = self.expenses.query(
                    KeyConditionExpression=Key("owner_id").eq(owner_id) & Key("group_sort_key").begins_with(f"{group_id}#"),
                    ConsistentRead=True,
                    ProjectionExpression="owner_id, group_sort_key",
                    ExclusiveStartKey=response["LastEvaluatedKey"],
                )
                for item in response.get("Items", []):
                    batch.delete_item(Key={"owner_id": owner_id, "group_sort_key": item["group_sort_key"]})

        try:
            self.client.delete_item(
                TableName=self.groups_table_name,
                Key=self._serialize({"owner_id": owner_id, "group_id": group_id}),
                ConditionExpression="#version = :expected AND #deleting = :deleting",
                ExpressionAttributeNames={"#version": "version", "#deleting": "deleting"},
                ExpressionAttributeValues={
                    ":expected": self.serializer.serialize(expected_version),
                    ":deleting": self.serializer.serialize(True),
                },
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            current = self.groups.get_item(Key={"owner_id": owner_id, "group_id": group_id}, ConsistentRead=True).get("Item")
            if current is None:
                return
            raise VersionConflict from exc

    def create_expense(self, owner_id: str, group_id: str, record: GroupExpenseRecord, key: str, payload_hash: str) -> GroupExpenseRecord:
        group_sort_key = self._expense_sort_key(group_id, record)
        item = record.model_dump(mode="json")
        item.update({"owner_id": owner_id, "group_sort_key": group_sort_key})
        owner_operation = f"{owner_id}#groups"
        idempotency_item = {
            "owner_operation": owner_operation,
            "idempotency_key": key,
            "resource_type": "expense",
            "resource_id": record.expense_id,
            "group_id": group_id,
            "group_sort_key": group_sort_key,
            "payload_hash": payload_hash,
            "expires_at": int(time.time()) + IDEMPOTENCY_RETENTION_SECONDS,
        }
        try:
            self.client.transact_write_items(TransactItems=[
                {"ConditionCheck": {
                    "TableName": self.groups_table_name,
                    "Key": self._serialize({"owner_id": owner_id, "group_id": group_id}),
                    "ConditionExpression": "attribute_exists(group_id) AND attribute_not_exists(deleting)",
                }},
                {"Put": {
                    "TableName": self.expenses_table_name,
                    "Item": self._serialize(item),
                    "ConditionExpression": "attribute_not_exists(owner_id) AND attribute_not_exists(group_sort_key)",
                }},
                {"Put": {
                    "TableName": self.idempotency_table_name,
                    "Item": self._serialize(idempotency_item),
                    "ConditionExpression": "attribute_not_exists(owner_operation) AND attribute_not_exists(idempotency_key)",
                }},
            ])
        except ClientError as exc:
            try:
                existing = self._existing_idempotent(owner_id, key, payload_hash, "expense", group_id)
            except IdempotencyConflict:
                raise
            if existing is not None:
                return existing
            # Distinguish a missing/foreign group from infrastructure failures.
            try:
                self.get(owner_id, group_id)
            except KeyError:
                raise
            raise exc
        return record

    def list_expenses(self, owner_id: str, group_id: str) -> list[GroupExpenseRecord]:
        response = self.expenses.query(
            KeyConditionExpression=Key("owner_id").eq(owner_id) & Key("group_sort_key").begins_with(f"{group_id}#"),
            ConsistentRead=True,
            ScanIndexForward=False,
        )
        items = response.get("Items", [])
        while "LastEvaluatedKey" in response:
            response = self.expenses.query(
                KeyConditionExpression=Key("owner_id").eq(owner_id) & Key("group_sort_key").begins_with(f"{group_id}#"),
                ConsistentRead=True,
                ScanIndexForward=False,
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            items.extend(response.get("Items", []))
        return [self._expense_record(item) for item in items]


def create_group_repository(settings: Settings) -> GroupRepository:
    if settings.groups_table and settings.shared_expenses_table and settings.idempotency_table:
        return DynamoDBGroupRepository(
            settings.groups_table,
            settings.shared_expenses_table,
            settings.idempotency_table,
            settings.aws_region,
        )
    if settings.groups_table or settings.shared_expenses_table:
        raise ValueError("Both DynamoDB group tables and the idempotency table must be configured")
    if settings.app_env == "aws":
        raise ValueError("DynamoDB group and shared expense tables must be configured in AWS")
    return SQLiteGroupRepository(settings.profile_db_path)
