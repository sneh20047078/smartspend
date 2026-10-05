import sqlite3
from pathlib import Path
from typing import Protocol

from botocore.exceptions import ClientError

from app.config import Settings
from app.models.profile import Profile, ProfilePatch


class ProfileRepository(Protocol):
    def get_or_create(self, subject: str, email: str) -> Profile: ...
    def update(self, subject: str, patch: ProfilePatch) -> Profile: ...


class SQLiteProfileRepository:
    """Local-development profile store; SQLite contains no credentials or tokens."""

    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS profiles (
                subject TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL,
                preferred_currency TEXT NOT NULL, timezone TEXT NOT NULL, theme TEXT NOT NULL
            )""")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _profile(row: sqlite3.Row) -> Profile:
        return Profile(**dict(row))

    def get_or_create(self, subject: str, email: str) -> Profile:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO profiles(subject,email,display_name,preferred_currency,timezone,theme) VALUES(?,?,?,?,?,?)",
                (subject, email, email.split("@")[0][:80] or "SmartSpend user", "USD", "UTC", "system"),
            )
            row = connection.execute("SELECT * FROM profiles WHERE subject = ?", (subject,)).fetchone()
        return self._profile(row)

    def update(self, subject: str, patch: ProfilePatch) -> Profile:
        changes = patch.model_dump(exclude_unset=True, exclude_none=True)
        if not changes:
            with self._connect() as connection:
                row = connection.execute("SELECT * FROM profiles WHERE subject = ?", (subject,)).fetchone()
            if row is None:
                raise KeyError(subject)
            return self._profile(row)
        columns = ", ".join(f"{key} = ?" for key in changes)
        with self._connect() as connection:
            cursor = connection.execute(
                f"UPDATE profiles SET {columns} WHERE subject = ?",
                (*changes.values(), subject),
            )
            if cursor.rowcount != 1:
                raise KeyError(subject)
            row = connection.execute("SELECT * FROM profiles WHERE subject = ?", (subject,)).fetchone()
        return self._profile(row)


class DynamoDBProfileRepository:
    """AWS profile adapter. The table's partition key is `subject`."""

    def __init__(self, table_name: str, region: str):
        import boto3
        self.table = boto3.resource("dynamodb", region_name=region).Table(table_name)

    def get_or_create(self, subject: str, email: str) -> Profile:
        response = self.table.get_item(Key={"subject": subject}, ConsistentRead=True)
        item = response.get("Item")
        if item is not None:
            return Profile(**item)
        profile = Profile(subject=subject, email=email, display_name=email.split("@")[0][:80] or "SmartSpend user")
        try:
            self.table.put_item(Item=profile.model_dump(mode="json"), ConditionExpression="attribute_not_exists(subject)")
        except ClientError as exc:
            # Concurrent first requests can race; return the winner's persisted record.
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            winner = self.table.get_item(Key={"subject": subject}, ConsistentRead=True).get("Item")
            if winner is None:
                raise
            return Profile(**winner)
        return profile

    def update(self, subject: str, patch: ProfilePatch) -> Profile:
        changes = patch.model_dump(exclude_unset=True, exclude_none=True)
        if not changes:
            response = self.table.get_item(Key={"subject": subject}, ConsistentRead=True)
            if "Item" not in response:
                raise KeyError(subject)
            return Profile(**response["Item"])
        names = {f"#field{i}": key for i, key in enumerate(changes)}
        values = {f":value{i}": value for i, value in enumerate(changes.values())}
        assignments = ", ".join(f"{name} = {value}" for name, value in zip(names, values))
        response = self.table.update_item(
            Key={"subject": subject},
            UpdateExpression=f"SET {assignments}",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(subject)",
            ReturnValues="ALL_NEW",
        )
        return Profile(**response["Attributes"])


def create_profile_repository(settings: Settings) -> ProfileRepository:
    if settings.profile_table:
        return DynamoDBProfileRepository(settings.profile_table, settings.aws_region)
    return SQLiteProfileRepository(settings.profile_db_path)
