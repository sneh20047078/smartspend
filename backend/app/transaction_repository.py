import base64
import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Generator, Protocol

import boto3
from boto3.dynamodb.types import TypeSerializer
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from app.config import Settings
from app.models.transaction import TransactionFilters, TransactionRecord

IDEMPOTENCY_RETENTION_SECONDS = 30 * 24 * 60 * 60
TRANSACTION_FIELDS = (
    "kind", "amount_minor", "currency", "category", "occurred_at", "notes",
    "payment_method", "created_at", "updated_at", "version",
)


class IdempotencyConflict(Exception):
    """An idempotency key was reused for a different request body."""


class VersionConflict(Exception):
    """A transaction was changed since it was last read."""


class InvalidCursor(Exception):
    """A pagination token is malformed or belongs to another owner."""


class TransactionRepository(Protocol):
    def create(self, owner_id: str, record: TransactionRecord, key: str, payload_hash: str) -> TransactionRecord: ...
    def get(self, owner_id: str, transaction_id: str) -> TransactionRecord: ...
    def list(self, owner_id: str, filters: TransactionFilters) -> tuple[list[TransactionRecord], str | None]: ...
    def update(self, owner_id: str, record: TransactionRecord, expected_version: int) -> TransactionRecord: ...
    def delete(self, owner_id: str, transaction_id: str, expected_version: int) -> None: ...


def encode_cursor(value: dict[str, str]) -> str:
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> dict[str, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        value = json.loads(raw)
        if not isinstance(value, dict) or not all(isinstance(key, str) and isinstance(item, str) for key, item in value.items()):
            raise ValueError
        return value
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise InvalidCursor("Invalid pagination cursor") from exc


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds")


def _search_text(record: TransactionRecord) -> str:
    return " ".join(filter(None, (record.kind, record.category, record.currency, record.notes, record.payment_method))).casefold()


def _sqlite_values(owner_id: str, record: TransactionRecord) -> tuple:
    return (
        owner_id, record.transaction_id, record.kind, record.amount_minor, record.currency,
        record.category, _iso(record.occurred_at), record.notes, record.payment_method,
        _iso(record.created_at), _iso(record.updated_at), record.version, _search_text(record),
    )


def _record_from_sqlite(row: sqlite3.Row) -> TransactionRecord:
    values = dict(row)
    for field in ("occurred_at", "created_at", "updated_at"):
        values[field] = datetime.fromisoformat(values[field])
    return TransactionRecord.model_validate(values)


class SQLiteTransactionRepository:
    """SQLite-backed local repository; all transaction queries require an owner key."""

    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS transactions (
                    owner_id TEXT NOT NULL,
                    transaction_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
                    currency TEXT NOT NULL,
                    category TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    notes TEXT,
                    payment_method TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    version INTEGER NOT NULL CHECK (version > 0),
                    search_text TEXT NOT NULL,
                    PRIMARY KEY (owner_id, transaction_id)
                );
                CREATE INDEX IF NOT EXISTS transactions_owner_occurred
                    ON transactions(owner_id, occurred_at DESC, transaction_id DESC);
                CREATE INDEX IF NOT EXISTS transactions_owner_kind_date
                    ON transactions(owner_id, kind, occurred_at DESC);
                CREATE TABLE IF NOT EXISTS transaction_idempotency (
                    owner_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    transaction_id TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    PRIMARY KEY (owner_id, idempotency_key)
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
    def _get_row(connection: sqlite3.Connection, owner_id: str, transaction_id: str) -> sqlite3.Row | None:
        return connection.execute(
            "SELECT transaction_id, kind, amount_minor, currency, category, occurred_at, notes, payment_method, created_at, updated_at, version "
            "FROM transactions WHERE owner_id = ? AND transaction_id = ?",
            (owner_id, transaction_id),
        ).fetchone()

    def create(self, owner_id: str, record: TransactionRecord, key: str, payload_hash: str) -> TransactionRecord:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            connection.execute("DELETE FROM transaction_idempotency WHERE owner_id = ? AND expires_at < ?", (owner_id, now))
            existing = connection.execute(
                "SELECT transaction_id, payload_hash FROM transaction_idempotency WHERE owner_id = ? AND idempotency_key = ?",
                (owner_id, key),
            ).fetchone()
            if existing is not None:
                if existing["payload_hash"] != payload_hash:
                    raise IdempotencyConflict
                row = self._get_row(connection, owner_id, existing["transaction_id"])
                if row is None:
                    raise IdempotencyConflict
                return _record_from_sqlite(row)
            connection.execute(
                "INSERT INTO transaction_idempotency(owner_id,idempotency_key,transaction_id,payload_hash,expires_at) VALUES(?,?,?,?,?)",
                (owner_id, key, record.transaction_id, payload_hash, now + IDEMPOTENCY_RETENTION_SECONDS),
            )
            connection.execute(
                "INSERT INTO transactions(owner_id,transaction_id,kind,amount_minor,currency,category,occurred_at,notes,payment_method,created_at,updated_at,version,search_text) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (*_sqlite_values(owner_id, record),),
            )
        return record

    def get(self, owner_id: str, transaction_id: str) -> TransactionRecord:
        with self._connection() as connection:
            row = self._get_row(connection, owner_id, transaction_id)
        if row is None:
            raise KeyError(transaction_id)
        return _record_from_sqlite(row)

    def list(self, owner_id: str, filters: TransactionFilters) -> tuple[list[TransactionRecord], str | None]:
        clauses = ["owner_id = ?"]
        parameters: list[object] = [owner_id]
        if filters.start_at is not None:
            clauses.append("occurred_at >= ?")
            parameters.append(_iso(filters.start_at))
        if filters.end_before is not None:
            clauses.append("occurred_at < ?")
            parameters.append(_iso(filters.end_before))
        if filters.kind:
            clauses.append("kind = ?")
            parameters.append(filters.kind)
        if filters.currency:
            clauses.append("currency = ?")
            parameters.append(filters.currency)
        if filters.category:
            clauses.append("lower(category) = ?")
            parameters.append(filters.category.casefold())
        if filters.search:
            clauses.append("instr(search_text, ?) > 0")
            parameters.append(filters.search.casefold())
        if filters.cursor:
            cursor = decode_cursor(filters.cursor)
            occurred_at = cursor.get("occurred_at")
            transaction_id = cursor.get("transaction_id")
            if not occurred_at or not transaction_id:
                raise InvalidCursor("Invalid pagination cursor")
            clauses.append("(occurred_at < ? OR (occurred_at = ? AND transaction_id < ?))")
            parameters.extend((occurred_at, occurred_at, transaction_id))
        columns = "transaction_id, kind, amount_minor, currency, category, occurred_at, notes, payment_method, created_at, updated_at, version"
        query = f"SELECT {columns} FROM transactions WHERE {' AND '.join(clauses)} ORDER BY occurred_at DESC, transaction_id DESC LIMIT ?"
        parameters.append(filters.limit + 1)
        with self._connection() as connection:
            rows = connection.execute(query, parameters).fetchall()
        has_more = len(rows) > filters.limit
        page_rows = rows[:filters.limit]
        next_cursor = None
        if has_more and page_rows:
            last = page_rows[-1]
            next_cursor = encode_cursor({"occurred_at": last["occurred_at"], "transaction_id": last["transaction_id"]})
        return [_record_from_sqlite(row) for row in page_rows], next_cursor

    def update(self, owner_id: str, record: TransactionRecord, expected_version: int) -> TransactionRecord:
        values = _sqlite_values(owner_id, record)
        assignments = "kind=?, amount_minor=?, currency=?, category=?, occurred_at=?, notes=?, payment_method=?, created_at=?, updated_at=?, version=?, search_text=?"
        with self._connection() as connection:
            cursor = connection.execute(
                f"UPDATE transactions SET {assignments} WHERE owner_id=? AND transaction_id=? AND version=?",
                (*values[2:-1], values[-1], owner_id, record.transaction_id, expected_version),
            )
            if cursor.rowcount != 1:
                current = self._get_row(connection, owner_id, record.transaction_id)
                if current is None:
                    raise KeyError(record.transaction_id)
                raise VersionConflict
        return record

    def delete(self, owner_id: str, transaction_id: str, expected_version: int) -> None:
        with self._connection() as connection:
            cursor = connection.execute(
                "DELETE FROM transactions WHERE owner_id=? AND transaction_id=? AND version=?",
                (owner_id, transaction_id, expected_version),
            )
            if cursor.rowcount != 1:
                current = self._get_row(connection, owner_id, transaction_id)
                if current is None:
                    raise KeyError(transaction_id)
                raise VersionConflict


class DynamoDBTransactionRepository:
    """Owner-partitioned DynamoDB transaction store with transactional idempotency writes."""

    def __init__(self, transaction_table: str, idempotency_table: str, region: str):
        self.dynamodb = boto3.resource("dynamodb", region_name=region)
        self.transaction_table_name = transaction_table
        self.idempotency_table_name = idempotency_table
        self.transactions = self.dynamodb.Table(transaction_table)
        self.idempotency = self.dynamodb.Table(idempotency_table)
        self.client = self.dynamodb.meta.client
        self.serializer = TypeSerializer()

    def _serialize(self, item: dict) -> dict:
        return {key: self.serializer.serialize(value) for key, value in item.items() if value is not None}

    @staticmethod
    def _from_item(item: dict) -> TransactionRecord:
        values = dict(item)
        values.pop("owner_id", None)
        values.pop("occurred_sort_key", None)
        values.pop("search_text", None)
        return TransactionRecord.model_validate(values)

    def create(self, owner_id: str, record: TransactionRecord, key: str, payload_hash: str) -> TransactionRecord:
        item = record.model_dump(mode="json")
        item.update({"owner_id": owner_id, "occurred_sort_key": f"{_iso(record.occurred_at)}#{record.transaction_id}", "search_text": _search_text(record)})
        idem_item = {
            "owner_operation": f"{owner_id}#transactions",
            "idempotency_key": key,
            "transaction_id": record.transaction_id,
            "payload_hash": payload_hash,
            "expires_at": int(time.time()) + IDEMPOTENCY_RETENTION_SECONDS,
        }
        try:
            self.client.transact_write_items(TransactItems=[
                {"Put": {"TableName": self.transaction_table_name, "Item": self._serialize(item), "ConditionExpression": "attribute_not_exists(owner_id)"}},
                {"Put": {"TableName": self.idempotency_table_name, "Item": self._serialize(idem_item), "ConditionExpression": "attribute_not_exists(owner_operation) AND attribute_not_exists(idempotency_key)"}},
            ])
        except ClientError as exc:
            existing = self.idempotency.get_item(Key={"owner_operation": idem_item["owner_operation"], "idempotency_key": key}, ConsistentRead=True).get("Item")
            if existing is not None:
                if existing.get("payload_hash") != payload_hash:
                    raise IdempotencyConflict from exc
                try:
                    return self.get(owner_id, existing["transaction_id"])
                except KeyError as missing:
                    raise IdempotencyConflict from missing
            raise
        return record

    def get(self, owner_id: str, transaction_id: str) -> TransactionRecord:
        response = self.transactions.get_item(Key={"owner_id": owner_id, "transaction_id": transaction_id}, ConsistentRead=True)
        item = response.get("Item")
        if item is None:
            raise KeyError(transaction_id)
        return self._from_item(item)

    def list(self, owner_id: str, filters: TransactionFilters) -> tuple[list[TransactionRecord], str | None]:
        cursor_key = None
        if filters.cursor:
            cursor_key = decode_cursor(filters.cursor)
            if cursor_key.get("owner_id") != owner_id or not cursor_key.get("transaction_id") or not cursor_key.get("occurred_sort_key"):
                raise InvalidCursor("Invalid pagination cursor")
        start = filters.start_at or datetime.min.replace(tzinfo=UTC)
        end_before = filters.end_before or datetime.max.replace(tzinfo=UTC)
        lower = f"{_iso(start)}#"
        upper = _iso(end_before)
        conditions = []
        if filters.kind:
            conditions.append(Attr("kind").eq(filters.kind))
        if filters.currency:
            conditions.append(Attr("currency").eq(filters.currency))
        if filters.category:
            conditions.append(Attr("category").eq(filters.category))
        if filters.search:
            conditions.append(Attr("search_text").contains(filters.search.casefold()))
        arguments = {
            "IndexName": "OwnerOccurredAtIndex",
            "KeyConditionExpression": Key("owner_id").eq(owner_id) & Key("occurred_sort_key").between(lower, upper),
            "ScanIndexForward": False,
            "Limit": filters.limit,
        }
        if conditions:
            condition = conditions[0]
            for extra in conditions[1:]:
                condition = condition & extra
            arguments["FilterExpression"] = condition
        if cursor_key:
            arguments["ExclusiveStartKey"] = cursor_key
        response = self.transactions.query(**arguments)
        records = [self._from_item(item) for item in response.get("Items", [])]
        last_key = response.get("LastEvaluatedKey")
        next_cursor = encode_cursor(last_key) if last_key else None
        return records, next_cursor

    def update(self, owner_id: str, record: TransactionRecord, expected_version: int) -> TransactionRecord:
        values = record.model_dump(mode="json")
        fields = {key: value for key, value in values.items() if key != "transaction_id"}
        fields["occurred_sort_key"] = f"{_iso(record.occurred_at)}#{record.transaction_id}"
        fields["search_text"] = _search_text(record)
        names = {f"#f{index}": key for index, key in enumerate(fields)}
        expression_values = {f":v{index}": self.serializer.serialize(value) for index, value in enumerate(fields.values())}
        set_expressions = ", ".join(f"{name} = :v{index}" for index, name in enumerate(names))
        try:
            self.client.update_item(
                TableName=self.transaction_table_name,
                Key=self._serialize({"owner_id": owner_id, "transaction_id": record.transaction_id}),
                UpdateExpression=f"SET {set_expressions}",
                ConditionExpression="#version = :expected",
                ExpressionAttributeNames={**names, "#version": "version"},
                ExpressionAttributeValues={**expression_values, ":expected": self.serializer.serialize(expected_version)},
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            try:
                self.get(owner_id, record.transaction_id)
            except KeyError as missing:
                raise missing
            raise VersionConflict from exc
        return record

    def delete(self, owner_id: str, transaction_id: str, expected_version: int) -> None:
        try:
            self.client.delete_item(
                TableName=self.transaction_table_name,
                Key=self._serialize({"owner_id": owner_id, "transaction_id": transaction_id}),
                ConditionExpression="#version = :expected",
                ExpressionAttributeNames={"#version": "version"},
                ExpressionAttributeValues={":expected": self.serializer.serialize(expected_version)},
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            try:
                self.get(owner_id, transaction_id)
            except KeyError as missing:
                raise missing
            raise VersionConflict from exc


def create_transaction_repository(settings: Settings) -> TransactionRepository:
    if settings.transactions_table and settings.idempotency_table:
        return DynamoDBTransactionRepository(settings.transactions_table, settings.idempotency_table, settings.aws_region)
    if settings.transactions_table or settings.idempotency_table:
        raise ValueError("Both transaction and idempotency table names must be configured")
    if settings.app_env == "aws":
        raise ValueError("DynamoDB transaction tables must be configured in AWS")
    return SQLiteTransactionRepository(settings.profile_db_path)
