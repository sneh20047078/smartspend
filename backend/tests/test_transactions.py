from concurrent.futures import ThreadPoolExecutor


def _payload(**overrides):
    value = {
        "kind": "expense",
        "amount_minor": 1299,
        "currency": "USD",
        "category": "Dining",
        "occurred_at": "2026-10-03T14:15:00-04:00",
        "notes": "  lunch with team  ",
        "payment_method": "card",
    }
    value.update(overrides)
    return value


def _create(client, headers, key, **overrides):
    return client.post(
        "/transactions",
        headers={**headers, "Idempotency-Key": key},
        json=_payload(**overrides),
    )


def test_create_uses_minor_units_utc_and_idempotency(client, auth_headers):
    created = _create(client, auth_headers, "request-transaction-0001")
    repeated = _create(client, auth_headers, "request-transaction-0001")

    assert created.status_code == 201
    assert created.json()["amount_minor"] == 1299
    assert created.json()["currency"] == "USD"
    assert created.json()["category"] == "dining"
    assert created.json()["notes"] == "lunch with team"
    assert created.json()["occurred_at"].endswith("Z") or created.json()["occurred_at"].endswith("+00:00")
    assert repeated.json()["transaction_id"] == created.json()["transaction_id"]
    assert repeated.json()["version"] == 1


def test_idempotency_key_cannot_be_reused_for_different_payload(client, auth_headers):
    _create(client, auth_headers, "request-transaction-0002", amount_minor=100)
    response = _create(client, auth_headers, "request-transaction-0002", amount_minor=200)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "request_error"


def test_parallel_retries_with_same_idempotency_key_create_one_transaction(client, auth_headers):
    def submit():
        return _create(client, auth_headers, "request-parallel-transaction-1").json()["transaction_id"]

    with ThreadPoolExecutor(max_workers=6) as pool:
        transaction_ids = list(pool.map(lambda _: submit(), range(6)))
    assert len(set(transaction_ids)) == 1
    assert len(client.get("/transactions", headers=auth_headers).json()["items"]) == 1


def test_create_rejects_zero_fractional_unsupported_currency_and_naive_dates(client, auth_headers):
    cases = [
        {"amount_minor": 0},
        {"amount_minor": 1.25},
        {"currency": "ZZZ"},
        {"occurred_at": "2026-10-03T14:15:00"},
        {"owner_id": "other-user"},
    ]
    for index, overrides in enumerate(cases):
        response = _create(client, auth_headers, f"invalid-transaction-key-{index:03d}", **overrides)
        assert response.status_code == 422, overrides


def test_transactions_are_owner_scoped(client, auth_headers):
    created = _create(client, auth_headers, "request-transaction-owner-1")
    transaction_id = created.json()["transaction_id"]
    other_login = client.post("/auth/dev-login", json={"email": "other@example.com"}).json()
    other_headers = {"Authorization": f"Bearer {other_login['access_token']}"}

    assert client.get(f"/transactions/{transaction_id}", headers=other_headers).status_code == 404
    assert client.get("/transactions", headers=other_headers).json()["items"] == []


def test_filter_search_and_cursor_pagination(client, auth_headers):
    _create(client, auth_headers, "request-transaction-page-0001", category="Dining", occurred_at="2026-10-01T12:00:00Z", notes="Cafe lunch")
    _create(client, auth_headers, "request-transaction-page-0002", category="Transit", occurred_at="2026-10-02T12:00:00Z", notes="Bus ticket")
    _create(client, auth_headers, "request-transaction-page-0003", kind="income", category="Pay", occurred_at="2026-10-03T12:00:00Z", notes="Monthly pay")

    response = client.get("/transactions?kind=expense&search=CAFE&limit=1", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["category"] == "dining"
    assert response.json()["next_cursor"] is None

    first_page = client.get("/transactions?kind=expense&limit=1", headers=auth_headers).json()
    assert first_page["items"][0]["category"] == "transit"
    next_page = client.get("/transactions", headers=auth_headers, params={"kind": "expense", "limit": 1, "cursor": first_page["next_cursor"]}).json()
    assert next_page["items"][0]["category"] == "dining"


def test_edit_delete_and_optimistic_version_conflicts(client, auth_headers):
    created = _create(client, auth_headers, "request-transaction-version-1").json()
    transaction_id = created["transaction_id"]
    updated = client.patch(
        f"/transactions/{transaction_id}",
        headers=auth_headers,
        json={"expected_version": 1, "amount_minor": 2500, "notes": None},
    )
    assert updated.status_code == 200
    assert updated.json()["amount_minor"] == 2500
    assert updated.json()["notes"] is None
    assert updated.json()["version"] == 2

    stale = client.patch(f"/transactions/{transaction_id}", headers=auth_headers, json={"expected_version": 1, "category": "Travel"})
    assert stale.status_code == 409
    stale_delete = client.delete(f"/transactions/{transaction_id}?expected_version=1", headers=auth_headers)
    assert stale_delete.status_code == 409
    assert client.delete(f"/transactions/{transaction_id}?expected_version=2", headers=auth_headers).status_code == 204
    assert client.get(f"/transactions/{transaction_id}", headers=auth_headers).status_code == 404


def test_dashboard_sums_by_currency_and_keeps_income_separate(client, auth_headers):
    _create(client, auth_headers, "request-dashboard-expense-001", amount_minor=3500, category="Groceries", occurred_at="2026-10-02T12:00:00Z")
    _create(client, auth_headers, "request-dashboard-income-001", kind="income", amount_minor=120000, currency="USD", category="Salary", occurred_at="2026-10-01T12:00:00Z")
    _create(client, auth_headers, "request-dashboard-yen-00001", kind="expense", amount_minor=800, currency="JPY", category="Transit", occurred_at="2026-10-04T12:00:00Z")

    response = client.get("/dashboard?start_date=2026-10-01&end_date=2026-10-31", headers=auth_headers)
    assert response.status_code == 200
    result = {entry["currency"]: entry for entry in response.json()["currencies"]}
    assert result["USD"] == {"currency": "USD", "income_minor": 120000, "expense_minor": 3500, "balance_minor": 116500}
    assert result["JPY"] == {"currency": "JPY", "income_minor": 0, "expense_minor": 800, "balance_minor": -800}
    assert response.json()["range_start"] == "2026-10-01"
    assert response.json()["range_end"] == "2026-10-31"
    assert response.json()["timezone"] == "UTC"
    assert response.json()["recent_transactions"][0]["currency"] == "JPY"


def test_dashboard_rejects_partial_and_oversized_ranges(client, auth_headers):
    partial = client.get("/dashboard?start_date=2026-01-01", headers=auth_headers)
    assert partial.status_code == 422
    too_large = client.get("/dashboard?start_date=2024-01-01&end_date=2026-10-01", headers=auth_headers)
    assert too_large.status_code == 422
