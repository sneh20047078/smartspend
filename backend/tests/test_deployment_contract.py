from pathlib import Path

import pytest
import yaml

from app.config import Settings


ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_PATH = ROOT / "infrastructure" / "template.yaml"


class SamTemplateLoader(yaml.SafeLoader):
    pass


def _unique_mapping(loader: SamTemplateLoader, node: yaml.MappingNode, deep: bool = False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise yaml.constructor.ConstructorError("while constructing a mapping", node.start_mark, f"duplicate key {key!r}", key_node.start_mark)
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


def _intrinsic(loader: SamTemplateLoader, suffix: str, node: yaml.Node):
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node)
    else:
        value = loader.construct_mapping(node)
    return {suffix: value}


SamTemplateLoader.add_multi_constructor("!", _intrinsic)
SamTemplateLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _unique_mapping)


@pytest.fixture(scope="module")
def template():
    with TEMPLATE_PATH.open(encoding="utf-8") as source:
        return yaml.load(source, Loader=SamTemplateLoader)


def test_aws_settings_fail_closed_when_any_resource_is_missing():
    with pytest.raises(ValueError, match="AWS configuration is incomplete"):
        Settings(app_env="aws", api_cors_origins="https://app.example.com")


def test_aws_settings_require_secure_explicit_frontend_origin():
    required = {
        "app_env": "aws",
        "api_cors_origins": "http://app.example.com",
        "cognito_user_pool_id": "pool-id",
        "cognito_app_client_id": "client-id",
        "profile_table": "profiles",
        "transactions_table": "transactions",
        "budgets_table": "budgets",
        "idempotency_table": "idempotency",
        "groups_table": "groups",
        "shared_expenses_table": "expenses",
        "recurring_schedules_table": "recurrences",
    }
    with pytest.raises(ValueError, match="AWS CORS origins must use HTTPS"):
        Settings(**required)


def test_sam_template_maps_durable_group_tables_and_all_group_routes(template):
    resources = template["Resources"]
    variables = template["Globals"]["Function"]["Environment"]["Variables"]
    assert variables["GROUPS_TABLE"] == {"Ref": "GroupsTable"}
    assert variables["SHARED_EXPENSES_TABLE"] == {"Ref": "SharedExpensesTable"}
    assert variables["RECURRING_SCHEDULES_TABLE"] == {"Ref": "RecurringSchedulesTable"}
    assert variables["APP_ENV"] == "aws"

    expected_routes = {
        ("POST", "/groups"),
        ("GET", "/groups"),
        ("GET", "/groups/{group_id}"),
        ("PATCH", "/groups/{group_id}"),
        ("DELETE", "/groups/{group_id}"),
        ("POST", "/groups/{group_id}/expenses"),
        ("GET", "/groups/{group_id}/expenses"),
        ("GET", "/groups/{group_id}/settlements"),
        ("POST", "/recurrences"),
        ("GET", "/recurrences"),
        ("POST", "/recurrences/process-due"),
        ("PATCH", "/recurrences/{schedule_id}"),
        ("DELETE", "/recurrences/{schedule_id}"),
    }
    events = resources["ProfileFunction"]["Properties"]["Events"].values()
    actual_routes = {
        (event["Properties"]["Method"], event["Properties"]["Path"])
        for event in events
        if event["Type"] == "HttpApi" and event["Properties"]["Path"].startswith(("/groups", "/recurrences"))
    }
    assert actual_routes == expected_routes
    assert "LocalDevAuthDisabledInAws" not in resources["ProfileFunction"]["Properties"]["Events"]
    assert resources["SmartSpendApi"]["Properties"]["Auth"]["DefaultAuthorizer"] == "CognitoJwtAuthorizer"


def test_financial_tables_are_encrypted_backed_up_and_retained(template):
    resources = template["Resources"]
    for name in ("ProfilesTable", "TransactionsTable", "BudgetsTable", "GroupsTable", "SharedExpensesTable", "RecurringSchedulesTable"):
        table = resources[name]
        properties = table["Properties"]
        assert table["DeletionPolicy"] == "Retain"
        assert table["UpdateReplacePolicy"] == "Retain"
        assert properties["SSESpecification"]["SSEEnabled"] is True
        assert properties["PointInTimeRecoverySpecification"]["PointInTimeRecoveryEnabled"] is True


def test_sam_template_requires_one_https_frontend_origin(template):
    web_origin = template["Parameters"]["WebOrigin"]
    assert "Default" not in web_origin
    assert web_origin["AllowedPattern"].startswith("^https://")
    assert template["Globals"]["Function"]["Environment"]["Variables"]["APP_ENV"] == "aws"


def test_sam_group_iam_is_table_scoped_and_includes_required_operations(template):
    function = template["Resources"]["ProfileFunction"]["Properties"]
    statements = function["Policies"][0]["PolicyDocument"]["Statement"]
    flattened = [(statement["Action"], statement["Resource"]) for statement in statements]
    group_arn = {"GetAtt": "GroupsTable.Arn"}
    expense_arn = {"GetAtt": "SharedExpensesTable.Arn"}
    resources_for = lambda resource: resource if isinstance(resource, list) else [resource]
    group_access = next(item for item in flattened if group_arn in resources_for(item[1]))
    expense_delete = next(item for item in flattened if item[1] == expense_arn)
    transaction_access = next(item for item in flattened if group_arn in resources_for(item[1]) and "dynamodb:TransactWriteItems" in item[0])

    assert {"dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:DeleteItem"}.issubset(set(group_access[0]))
    assert "dynamodb:BatchWriteItem" in expense_delete[0]
    assert group_arn in resources_for(transaction_access[1])
    assert expense_arn in resources_for(transaction_access[1])
    assert all(resource != "*" for _, resources in flattened for resource in resources_for(resources))
