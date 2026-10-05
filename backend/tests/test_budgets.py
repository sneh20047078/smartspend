def _budget_payload(**overrides):
    payload = {
        "name": "  October plan  ",
        "period_type": "monthly",
        "start_date": "2026-10-01",
        "end_date": "2026-10-31",
        "currency": "USD",
        "total_limit_minor": 3000,
        "category_limits": {" Groceries ": 2000, "Dining": 1000},
        "alert_threshold_percent": 80,
    }
    payload.update(overrides)
    return payload


def _create_budget(client, headers, key="request-budget-create-0001", **overrides):
    return client.post(
        "/budgets",
        headers={**headers, "Idempotency-Key": key},
        json=_budget_payload(**overrides),
    )


def _create_transaction(client, headers, key, **overrides):
    payload = {
        "kind": "expense",
        "amount_minor": 100,
        "currency": "USD",
        "category": "groceries",
        "occurred_at": "2026-10-15T12:00:00Z",
    }
    payload.update(overrides)
    return client.post("/transactions", headers={**headers, "Idempotency-Key": key}, json=payload)


def test_budget_create_is_idempotent_and_normalizes_fields(client, auth_headers):
    created = _create_budget(client, auth_headers)
    repeated = _create_budget(client, auth_headers)

    assert created.status_code == 201
    assert created.json()["name"] == "October plan"
    assert created.json()["currency"] == "USD"
    assert created.json()["category_limits"] == {"groceries": 2000, "dining": 1000}
    assert repeated.json()["budget_id"] == created.json()["budget_id"]
    assert repeated.json()["version"] == 1

    conflict = _create_budget(client, auth_headers, "request-budget-create-0001", total_limit_minor=4000)
    assert conflict.status_code == 409


def test_budget_status_counts_only_matching_expenses_in_inclusive_period(client, auth_headers):
    _create_budget(client, auth_headers)
    _create_transaction(client, auth_headers, "budget-expense-first-0001", amount_minor=1200, occurred_at="2026-10-01T00:00:00Z")
    _create_transaction(client, auth_headers, "budget-expense-last-0001", amount_minor=500, occurred_at="2026-10-31T23:59:59Z")
    _create_transaction(client, auth_headers, "budget-expense-dining-01", amount_minor=400, category="dining")
    _create_transaction(client, auth_headers, "budget-income-groceries-1", amount_minor=9000, kind="income")
    _create_transaction(client, auth_headers, "budget-expense-cad-0001", amount_minor=800, currency="CAD")
    _create_transaction(client, auth_headers, "budget-expense-before-01", amount_minor=700, occurred_at="2026-09-30T23:59:59Z")
    _create_transaction(client, auth_headers, "budget-expense-after-001", amount_minor=600, occurred_at="2026-11-01T00:00:00Z")

    response = client.get("/budgets", headers=auth_headers)
    assert response.status_code == 200
    result = response.json()["items"][0]
    progress = {item["category"]: item for item in result["categories"]}
    assert progress["all spending"] == {
        "category": "all spending", "limit_minor": 3000, "spent_minor": 2100,
        "remaining_minor": 900, "percent_used": 70, "threshold_reached": False,
    }
    assert progress["groceries"] == {
        "category": "groceries", "limit_minor": 2000, "spent_minor": 1700,
        "remaining_minor": 300, "percent_used": 85, "threshold_reached": True,
    }
    assert progress["dining"]["spent_minor"] == 400
    assert progress["dining"]["threshold_reached"] is False


def test_budget_is_owner_scoped_and_supports_versioned_crud(client, auth_headers):
    created = _create_budget(client, auth_headers).json()
    budget_id = created["budget_id"]
    other_login = client.post("/auth/dev-login", json={"email": "budget-other@example.com"}).json()
    other_headers = {"Authorization": f"Bearer {other_login['access_token']}"}

    assert client.get(f"/budgets/{budget_id}", headers=other_headers).status_code == 404
    assert client.get("/budgets", headers=other_headers).json()["items"] == []

    updated = client.patch(
        f"/budgets/{budget_id}", headers=auth_headers,
        json={"expected_version": 1, "name": "Updated plan", "alert_threshold_percent": 90},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Updated plan"
    assert updated.json()["version"] == 2

    stale = client.patch(f"/budgets/{budget_id}", headers=auth_headers, json={"expected_version": 1, "name": "Stale"})
    assert stale.status_code == 409
    assert client.delete(f"/budgets/{budget_id}?expected_version=1", headers=auth_headers).status_code == 409
    assert client.delete(f"/budgets/{budget_id}?expected_version=2", headers=auth_headers).status_code == 204
    assert client.get(f"/budgets/{budget_id}", headers=auth_headers).status_code == 404


def test_budget_validation_rejects_missing_limits_bad_month_and_unknown_fields(client, auth_headers):
    cases = [
        _budget_payload(total_limit_minor=None, category_limits={}),
        _budget_payload(end_date="2026-10-30"),
        _budget_payload(currency="ZZZ"),
        _budget_payload(unexpected="not allowed"),
        _budget_payload(category_limits={"food": 1.5}),
    ]
    for index, payload in enumerate(cases):
        response = client.post(
            "/budgets",
            headers={**auth_headers, "Idempotency-Key": f"invalid-budget-request-{index:03d}"},
            json=payload,
        )
        assert response.status_code == 422, payload


def test_budget_update_must_preserve_at_least_one_limit(client, auth_headers):
    created = _create_budget(client, auth_headers).json()
    response = client.patch(
        f"/budgets/{created['budget_id']}", headers=auth_headers,
        json={"expected_version": 1, "total_limit_minor": None, "category_limits": {}},
    )
    assert response.status_code == 422
    assert client.get(f"/budgets/{created['budget_id']}", headers=auth_headers).json()["version"] == 1


def test_budget_create_allows_idempotency_header_in_cors_preflight(client):
    response = client.options(
        "/budgets",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
        },
    )
    assert response.status_code == 200
    assert "idempotency-key" in response.headers["access-control-allow-headers"].lower()
