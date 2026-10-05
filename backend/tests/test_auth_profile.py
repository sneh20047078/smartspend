from app.auth.jwt import AuthenticationError, issue_local_token, verify_token
from app.config import Settings


def test_local_dev_login_creates_profile_without_password(client):
    response = client.post("/auth/dev-login", json={"email": "Alex@example.com"})
    assert response.status_code == 200
    assert "access_token" in response.json()
    assert "password" not in response.json()
    profile = client.get("/me", headers={"Authorization": f"Bearer {response.json()['access_token']}"})
    assert profile.status_code == 200
    assert profile.json()["email"] == "alex@example.com"


def test_unauthenticated_profile_is_rejected(client):
    response = client.get("/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_profile_update_is_scoped_to_authenticated_subject(client, auth_headers):
    response = client.patch("/me", headers=auth_headers, json={"display_name": "  Alex Rivera ", "preferred_currency": "cad", "timezone": "America/Toronto"})
    assert response.status_code == 200
    assert response.json()["display_name"] == "Alex Rivera"
    assert response.json()["preferred_currency"] == "CAD"
    assert response.json()["timezone"] == "America/Toronto"
    assert "subject" not in response.json()


def test_profile_rejects_invalid_values(client, auth_headers):
    response = client.patch("/me", headers=auth_headers, json={"preferred_currency": "US", "theme": "neon"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_profile_rejects_unknown_fields(client, auth_headers):
    response = client.patch("/me", headers=auth_headers, json={"user_id": "attacker", "display_name": "Alex"})
    assert response.status_code == 422


def test_profiles_are_isolated_and_repeated_local_login_preserves_profile(client):
    first = client.post("/auth/dev-login", json={"email": "first@example.com"}).json()["access_token"]
    first_headers = {"Authorization": f"Bearer {first}"}
    client.patch("/me", headers=first_headers, json={"display_name": "First User"})

    repeated = client.post("/auth/dev-login", json={"email": "first@example.com"}).json()["access_token"]
    repeated_profile = client.get("/me", headers={"Authorization": f"Bearer {repeated}"}).json()
    second = client.post("/auth/dev-login", json={"email": "second@example.com"}).json()["access_token"]
    second_profile = client.get("/me", headers={"Authorization": f"Bearer {second}"}).json()

    assert repeated_profile["display_name"] == "First User"
    assert second_profile["display_name"] == "second"
    assert "subject" not in second_profile


def test_token_signature_is_verified(settings):
    token, _ = issue_local_token("a@example.com", settings)
    assert verify_token(token, settings)["email"] == "a@example.com"
    other = Settings(app_env="local", smartspend_dev_jwt_secret="different-test-secret-that-is-long-enough")
    try:
        verify_token(token, other)
    except AuthenticationError:
        pass
    else:
        raise AssertionError("a token signed by a different secret must be rejected")


def test_local_login_is_hidden_outside_local_environment(settings, tmp_path):
    from fastapi.testclient import TestClient
    from app.budget_repository import SQLiteBudgetRepository
    from app.main import create_app
    from app.repositories import SQLiteProfileRepository
    from app.transaction_repository import SQLiteTransactionRepository

    settings.app_env = "aws"
    database = str(tmp_path / "aws-test.sqlite3")
    app = create_app(
        settings,
        SQLiteProfileRepository(database),
        SQLiteTransactionRepository(database),
        SQLiteBudgetRepository(database),
    )
    assert TestClient(app).post("/auth/dev-login", json={"email": "a@example.com"}).status_code == 404


def test_local_login_requires_a_development_secret(settings, tmp_path):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.repositories import SQLiteProfileRepository

    settings.smartspend_dev_jwt_secret = ""
    app = create_app(settings, SQLiteProfileRepository(str(tmp_path / "no-secret.sqlite3")))
    response = TestClient(app).post("/auth/dev-login", json={"email": "a@example.com"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"
