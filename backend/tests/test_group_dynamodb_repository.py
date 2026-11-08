from datetime import UTC, datetime

import pytest

from app import group_repository
from app.models.group import GroupExpenseRecord


class FakeClient:
    def __init__(self):
        self.transact_calls = []
        self.update_calls = []
        self.delete_calls = []

    def transact_write_items(self, **kwargs):
        self.transact_calls.append(kwargs)

    def update_item(self, **kwargs):
        self.update_calls.append(kwargs)

    def delete_item(self, **kwargs):
        self.delete_calls.append(kwargs)


class FakeTable:
    def __init__(self, name):
        self.name = name
        self.item = None
        self.calls = []

    def get_item(self, **kwargs):
        self.calls.append(kwargs)
        return {"Item": self.item} if self.item is not None else {}

    def query(self, **kwargs):
        self.calls.append(kwargs)
        return {"Items": []}

    def batch_writer(self):
        return FakeBatchWriter()


class FakeBatchWriter:
    def __init__(self):
        self.exit_args = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.exit_args = args
        return None

    def delete_item(self, **kwargs):
        raise AssertionError(f"no expenses should exist in the deletion test: {kwargs}")


class FakeDynamoResource:
    def __init__(self):
        self.tables = {}
        self.meta = type("Meta", (), {"client": FakeClient()})()

    def Table(self, name):
        return self.tables.setdefault(name, FakeTable(name))


def _expense():
    now = datetime.now(UTC)
    return GroupExpenseRecord(
        expense_id="expense-123",
        group_id="group-456",
        description="Shared meal",
        amount_minor=3000,
        currency="USD",
        paid_by="alex@example.com",
        split_type="equal",
        splits={"alex@example.com": 1500, "sam@example.com": 1500},
        occurred_at=now,
        created_at=now,
        updated_at=now,
        version=1,
    )


def test_dynamodb_expense_write_is_owner_scoped_and_atomic_with_idempotency(monkeypatch):
    resource = FakeDynamoResource()
    def fake_resource(service_name, region_name):
        assert service_name == "dynamodb"
        assert region_name == "us-east-1"
        return resource

    monkeypatch.setattr(group_repository.boto3, "resource", fake_resource)
    repository = group_repository.DynamoDBGroupRepository("groups", "expenses", "idempotency", "us-east-1")

    result = repository.create_expense("cognito-subject-1", "group-456", _expense(), "idem-key-12345678", "payload-hash")

    assert result.expense_id == "expense-123"
    operations = resource.meta.client.transact_calls[0]["TransactItems"]
    assert len(operations) == 3
    condition_check = operations[0]["ConditionCheck"]
    assert condition_check["TableName"] == "groups"
    assert condition_check["Key"]["owner_id"] == {"S": "cognito-subject-1"}
    assert condition_check["Key"]["group_id"] == {"S": "group-456"}

    expense_item = operations[1]["Put"]["Item"]
    assert operations[1]["Put"]["TableName"] == "expenses"
    assert expense_item["owner_id"] == {"S": "cognito-subject-1"}
    assert expense_item["group_id"] == {"S": "group-456"}
    assert expense_item["expense_id"] == {"S": "expense-123"}

    idempotency_item = operations[2]["Put"]["Item"]
    assert idempotency_item["owner_operation"] == {"S": "cognito-subject-1#groups"}
    assert idempotency_item["resource_type"] == {"S": "expense"}
    assert idempotency_item["group_sort_key"]["S"].startswith("group-456#")


def test_dynamodb_group_factory_selects_durable_adapter(monkeypatch):
    expected = object()
    def fake_repository(groups_table, expenses_table, idempotency_table, region):
        assert (groups_table, expenses_table, idempotency_table, region) == ("groups", "expenses", "idempotency", "us-east-1")
        return expected

    monkeypatch.setattr(group_repository, "DynamoDBGroupRepository", fake_repository)
    settings = type("SettingsStub", (), {
        "groups_table": "groups",
        "shared_expenses_table": "expenses",
        "idempotency_table": "idempotency",
        "aws_region": "us-east-1",
        "app_env": "aws",
    })()

    assert group_repository.create_group_repository(settings) is expected


def test_dynamodb_group_factory_does_not_fall_back_to_sqlite_in_aws():
    settings = type("SettingsStub", (), {
        "groups_table": "",
        "shared_expenses_table": "",
        "idempotency_table": "",
        "aws_region": "us-east-1",
        "app_env": "aws",
    })()

    with pytest.raises(ValueError, match="DynamoDB group and shared expense tables"):
        group_repository.create_group_repository(settings)


def test_dynamodb_group_delete_marks_tombstone_before_removing_record(monkeypatch):
    resource = FakeDynamoResource()
    def fake_resource(service_name, region_name):
        assert service_name == "dynamodb"
        assert region_name == "us-east-1"
        return resource

    monkeypatch.setattr(group_repository.boto3, "resource", fake_resource)
    resource.Table("groups").item = {"owner_id": "owner-1", "group_id": "group-1", "version": 2}
    repository = group_repository.DynamoDBGroupRepository("groups", "expenses", "idempotency", "us-east-1")

    repository.delete("owner-1", "group-1", 2)

    assert resource.meta.client.update_calls[0]["UpdateExpression"] == "SET #deleting = :deleting"
    assert resource.meta.client.update_calls[0]["ExpressionAttributeValues"][":deleting"] == {"BOOL": True}
    assert resource.meta.client.delete_calls[0]["ConditionExpression"] == "#version = :expected AND #deleting = :deleting"
