import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.repositories import SQLiteProfileRepository


@pytest.fixture
def settings(tmp_path):
    return Settings(
        app_env="local",
        api_cors_origins="http://localhost:5173",
        smartspend_dev_jwt_secret="test-only-secret-that-is-long-enough-123456",
        smartspend_dev_token_minutes=60,
        profile_db_path=str(tmp_path / "profiles.sqlite3"),
    )


@pytest.fixture
def client(settings, tmp_path):
    repository = SQLiteProfileRepository(str(tmp_path / "profiles.sqlite3"))
    return TestClient(create_app(settings=settings, repository=repository))


@pytest.fixture
def auth_headers(client):
    response = client.post("/auth/dev-login", json={"email": "alex@example.com"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
