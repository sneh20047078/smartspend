from functools import lru_cache
from typing import Any

import jwt
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientError

from app.config import Settings


class AuthenticationError(Exception):
    """Raised when a bearer token cannot be trusted."""


def issue_local_token(email: str, settings: Settings) -> tuple[str, str]:
    if settings.app_env != "local":
        raise AuthenticationError("Local authentication is disabled")
    if len(settings.smartspend_dev_jwt_secret) < 32:
        raise AuthenticationError("Local authentication secret is not configured")
    normalized_email = email.strip().lower()
    subject = f"local:{normalized_email}"
    token = jwt.encode(
        {"sub": subject, "email": normalized_email, "iss": "smartspend-local", "aud": "smartspend-local-api",
        "iat": int(__import__("time").time()), "exp": int(__import__("time").time()) + settings.smartspend_dev_token_minutes * 60,
         "token_use": "dev"},
        settings.smartspend_dev_jwt_secret,
        algorithm="HS256",
    )
    return token, subject


@lru_cache(maxsize=8)
def _jwks_client(region: str, pool_id: str) -> PyJWKClient:
    issuer = f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"
    return PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def verify_token(token: str, settings: Settings) -> dict[str, Any]:
    try:
        if settings.app_env == "local":
            if len(settings.smartspend_dev_jwt_secret) < 32:
                raise AuthenticationError("Local authentication secret is not configured")
            claims = jwt.decode(
                token,
                settings.smartspend_dev_jwt_secret,
                algorithms=["HS256"],
                audience="smartspend-local-api",
                issuer="smartspend-local",
                options={"require": ["exp", "iat", "sub", "email"]},
            )
            if claims.get("token_use") != "dev":
                raise AuthenticationError("Invalid token type")
            return claims

        if not settings.cognito_user_pool_id or not settings.cognito_app_client_id:
            raise AuthenticationError("Cognito is not configured")
        issuer = f"https://cognito-idp.{settings.aws_region}.amazonaws.com/{settings.cognito_user_pool_id}"
        signing_key = _jwks_client(settings.aws_region, settings.cognito_user_pool_id).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.cognito_app_client_id,
            issuer=issuer,
            options={"require": ["exp", "iat", "sub", "email", "token_use"]},
        )
        if claims.get("token_use") != "id":
            raise AuthenticationError("An identity token is required")
        return claims
    except AuthenticationError:
        raise
    except (InvalidTokenError, PyJWKClientError, OSError, ValueError) as exc:
        raise AuthenticationError("Invalid or expired bearer token") from exc
