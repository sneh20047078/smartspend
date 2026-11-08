from datetime import date, timedelta


def _payload(**overrides):
    payload = {
        "description": "Rent",
        "amount_minor": 150000,
        "currency": "USD",
        "category": "housing",
        "frequency": "monthly",
        "interval": 1,
        "starts_on": "2024-01-31",
        "ends_on": "2024-04-30",
    }
    payload.update(overrides)
    return payload


def _create(client, headers, key, **overrides):
    return client.post(
        "/recurrences",
        headers={**headers, "Idempotency-Key": key},
        json=_payload(**overrides),
    )


def test_monthly_schedule_generates_idempotent_expenses_and_preserves_month_day(client, auth_headers):
    created = _create(client, auth_headers, "monthly-rent-create-key-001")
    repeated = _create(client, auth_headers, "monthly-rent-create-key-001")
    assert created.status_code == 201
    assert repeated.json()["schedule_id"] == created.json()["schedule_id"]

    assert client.get("/recurrences", headers=auth_headers).json()[0]["next_occurrence_on"] == "2024-01-31"
    due = client.post("/recurrences/process-due", headers=auth_headers)
    assert due.status_code == 200
    assert due.json() == {"generated_count": 4}

    schedules = client.get("/recurrences", headers=auth_headers)
    assert schedules.status_code == 200
    assert schedules.json()[0]["next_occurrence_on"] == "2024-04-30"
    assert schedules.json()[0]["enabled"] is False

    transactions = client.get(
        "/transactions?start_date=2024-01-01&end_date=2024-05-31&limit=100",
        headers=auth_headers,
    ).json()["items"]
    assert [item["occurred_at"][:10] for item in transactions] == [
        "2024-04-30", "2024-03-31", "2024-02-29", "2024-01-31",
    ]
    assert all(item["category"] == "housing" and item["amount_minor"] == 150000 for item in transactions)


def test_weekly_schedule_can_pause_resume_and_delete_with_version(client, auth_headers):
    created = _create(
        client,
        auth_headers,
        "weekly-coffee-create-key-001",
        description="Coffee beans",
        amount_minor=2200,
        frequency="weekly",
        interval=2,
        starts_on=(date.today() + timedelta(days=1)).isoformat(),
        ends_on=None,
    )
    schedule = created.json()
    paused = client.patch(
        f"/recurrences/{schedule['schedule_id']}",
        headers=auth_headers,
        json={"expected_version": 1, "enabled": False},
    )
    assert paused.status_code == 200
    assert paused.json()["enabled"] is False
    assert paused.json()["version"] == 2

    deleted = client.delete(
        f"/recurrences/{schedule['schedule_id']}?expected_version=2",
        headers=auth_headers,
    )
    assert deleted.status_code == 204
    assert client.get("/recurrences", headers=auth_headers).json() == []


def test_recurrence_input_rejects_bad_intervals_and_dates(client, auth_headers):
    bad_interval = _create(client, auth_headers, "bad-monthly-interval-key-001", frequency="monthly", interval=13)
    bad_dates = _create(client, auth_headers, "bad-monthly-dates-key-0001", starts_on="2024-04-30", ends_on="2024-04-01")
    assert bad_interval.status_code == 422
    assert bad_dates.status_code == 422
