def _group_payload(**overrides):
    payload = {
        "name": "  Weekend getaway  ",
        "description": "  Beach weekend  ",
        "currency": "USD",
        "members": ["alex@example.com", "sam@example.com", "taylor@example.com"],
    }
    payload.update(overrides)
    return payload


def _create_group(client, headers, key, **overrides):
    return client.post(
        "/groups",
        headers={**headers, "Idempotency-Key": key},
        json=_group_payload(**overrides),
    )


def _create_expense(client, headers, group_id, key, **overrides):
    payload = {
        "description": "Hotel",
        "amount_minor": 3000,
        "currency": "USD",
        "paid_by": "alex@example.com",
        "split_type": "equal",
        "occurred_at": "2026-10-03T12:00:00Z",
    }
    payload.update(overrides)
    return client.post(f"/groups/{group_id}/expenses", headers={**headers, "Idempotency-Key": key}, json=payload)


def test_group_create_is_idempotent_and_owner_scoped(client, auth_headers):
    created = _create_group(client, auth_headers, "request-group-create-0001")
    repeated = _create_group(client, auth_headers, "request-group-create-0001")

    assert created.status_code == 201
    assert created.json()["name"] == "Weekend getaway"
    assert created.json()["members"] == ["alex@example.com", "sam@example.com", "taylor@example.com"]
    assert repeated.json()["group_id"] == created.json()["group_id"]

    other_login = client.post("/auth/dev-login", json={"email": "other@example.com"}).json()
    other_headers = {"Authorization": f"Bearer {other_login['access_token']}"}
    assert client.get(f"/groups/{created.json()['group_id']}", headers=other_headers).status_code == 404


def test_group_expenses_are_split_and_netted_for_settlements(client, auth_headers):
    group = _create_group(client, auth_headers, "request-group-split-0001").json()
    _create_expense(client, auth_headers, group["group_id"], "request-expense-hotel-0001", description="Hotel", amount_minor=3000, paid_by="alex@example.com")
    _create_expense(client, auth_headers, group["group_id"], "request-expense-dinner-0001", description="Dinner", amount_minor=1200, paid_by="sam@example.com")

    summary = client.get(f"/groups/{group['group_id']}/settlements", headers=auth_headers)
    assert summary.status_code == 200

    balances = {item["member_id"]: item["net_minor"] for item in summary.json()["balances"]}
    assert balances == {
        "alex@example.com": 1600,
        "sam@example.com": -200,
        "taylor@example.com": -1400,
    }

    settlements = summary.json()["settlements"]
    assert settlements == [
        {"from_member": "sam@example.com", "to_member": "alex@example.com", "amount_minor": 200},
        {"from_member": "taylor@example.com", "to_member": "alex@example.com", "amount_minor": 1400},
    ]


def test_group_validation_rejects_missing_members_and_unknown_split_members(client, auth_headers):
    cases = [
        _group_payload(members=[]),
        _group_payload(name=""),
        _group_payload(currency="ZZZ"),
        _group_payload(unexpected="not allowed"),
    ]
    for index, payload in enumerate(cases):
        response = client.post(
            "/groups",
            headers={**auth_headers, "Idempotency-Key": f"invalid-group-request-{index:03d}"},
            json=payload,
        )
        assert response.status_code == 422, payload

    group = _create_group(client, auth_headers, "request-group-custom-0001").json()
    response = _create_expense(
        client,
        auth_headers,
        group["group_id"],
        "expense-invalid-0001",
        split_type="custom",
        splits={"alex@example.com": 1000, "sam@example.com": 1000},
    )
    assert response.status_code == 422


def test_group_owner_member_label_uses_email_claim_not_subject():
    from app.services.groups import GroupService

    assert GroupService._normalize_members(
        "cognito-subject-123",
        ["friend@example.com"],
        "owner@example.com",
    ) == ["owner@example.com", "friend@example.com"]
