import logging
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from mangum import Mangum
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.auth.dependencies import current_claims
from app.auth.jwt import AuthenticationError, issue_local_token
from app.config import Settings, get_settings
from app.models.profile import ProfilePatch, ProfileView
from app.models.budget import BudgetCreate, BudgetPatch, BudgetRecord, BudgetStatus, BudgetStatusPage
from app.models.group import GroupCreate, GroupExpenseCreate, GroupExpenseRecord, GroupPatch, GroupRecord, GroupSettlementSummary
from app.models.recurrence import RecurrenceCreate, RecurrencePatch, RecurrenceProcessResult, RecurringSchedule
from app.models.transaction import (
    DashboardSummary,
    TransactionCreate,
    TransactionFilters,
    TransactionPage,
    TransactionPatch,
    TransactionRecord,
    TransactionKind,
)
from app.repositories import ProfileRepository, create_profile_repository
from app.budget_repository import BudgetRepository, create_budget_repository
from app.group_repository import GroupRepository, create_group_repository
from app.recurrence_repository import RecurrenceRepository, create_recurrence_repository
from app.services.budgets import BudgetService
from app.services.groups import GroupService
from app.services.recurrences import RecurrenceService
from app.services.transactions import TransactionService
from app.transaction_repository import (
    IdempotencyConflict,
    InvalidCursor,
    TransactionRepository,
    VersionConflict,
    create_transaction_repository,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("smartspend.api")


class DevLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr


class DevLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str = Field(min_length=1, max_length=80)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: ProfileView


def create_app(
    settings: Settings | None = None,
    repository: ProfileRepository | None = None,
    transaction_repository: TransactionRepository | None = None,
    budget_repository: BudgetRepository | None = None,
    group_repository: GroupRepository | None = None,
    recurrence_repository: RecurrenceRepository | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield

    application = FastAPI(title="SmartSpend API", version="0.1.0", lifespan=lifespan)
    application.state.settings = settings or get_settings()
    application.state.profile_repository = repository or create_profile_repository(application.state.settings)
    selected_transaction_repository = transaction_repository or create_transaction_repository(application.state.settings)
    application.state.transaction_service = TransactionService(selected_transaction_repository)
    selected_budget_repository = budget_repository or create_budget_repository(application.state.settings)
    application.state.budget_service = BudgetService(selected_budget_repository, selected_transaction_repository)
    selected_group_repository = group_repository or create_group_repository(application.state.settings)
    application.state.group_service = GroupService(selected_group_repository)
    selected_recurrence_repository = recurrence_repository or create_recurrence_repository(application.state.settings)
    application.state.recurrence_service = RecurrenceService(selected_recurrence_repository, application.state.transaction_service)
    application.dependency_overrides[get_settings] = lambda: application.state.settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=application.state.settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
        max_age=600,
    )

    @application.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, exc: RequestValidationError):
        fields = [
            {"field": ".".join(str(part) for part in error["loc"] if part != "body"), "message": error["msg"]}
            for error in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"error": {"code": "validation_error", "message": "Request validation failed", "fields": fields}})

    @application.exception_handler(HTTPException)
    async def http_error_handler(_: Request, exc: HTTPException):
        code = {
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            503: "service_unavailable",
        }.get(exc.status_code, "request_error")
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": code, "message": str(exc.detail)}},
            headers=exc.headers,
        )

    @application.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", "unassigned")
        logger.error("Unhandled request error request_id=%s type=%s", request_id, type(exc).__name__)
        return JSONResponse(status_code=500, content={"error": {"code": "internal_error", "message": "An unexpected error occurred"}})

    @application.get("/health", tags=["system"])
    def health():
        return {"status": "ok", "phase": "finance-groups-reports"}

    @application.post("/auth/dev-login", response_model=DevLoginResponse, tags=["authentication"])
    def dev_login(payload: DevLoginRequest, request: Request):
        active_settings: Settings = request.app.state.settings
        if active_settings.app_env != "local":
            raise HTTPException(status_code=404, detail="Not found")
        try:
            token, subject = issue_local_token(str(payload.email), active_settings)
        except AuthenticationError as exc:
            raise HTTPException(status_code=503, detail="Local authentication is not configured") from exc
        request.app.state.profile_repository.get_or_create(subject, str(payload.email).lower())
        return DevLoginResponse(access_token=token, expires_in=active_settings.smartspend_dev_token_minutes * 60)

    @application.post("/auth/register", response_model=AuthResponse, tags=["authentication"])
    def register_user_endpoint(payload: RegisterRequest, request: Request):
        repo = request.app.state.profile_repository
        if not hasattr(repo, "register_user"):
            raise HTTPException(status_code=400, detail="Account registration is managed by Cognito in AWS mode.")
        try:
            profile = repo.register_user(str(payload.email), payload.password, payload.display_name)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        token, _ = issue_local_token(str(payload.email), request.app.state.settings, subject=profile.subject)
        return AuthResponse(
            access_token=token,
            expires_in=request.app.state.settings.smartspend_dev_token_minutes * 60,
            user=ProfileView(email=profile.email, display_name=profile.display_name, preferred_currency=profile.preferred_currency, timezone=profile.timezone, theme=profile.theme),
        )

    @application.post("/auth/login", response_model=AuthResponse, tags=["authentication"])
    def login_user_endpoint(payload: LoginRequest, request: Request):
        repo = request.app.state.profile_repository
        if not hasattr(repo, "authenticate_user"):
            raise HTTPException(status_code=400, detail="Sign in is managed by Cognito in AWS mode.")
        profile = repo.authenticate_user(str(payload.email), payload.password)
        if profile is None:
            raise HTTPException(status_code=401, detail="Incorrect email address or password.")
        token, _ = issue_local_token(str(payload.email), request.app.state.settings, subject=profile.subject)
        return AuthResponse(
            access_token=token,
            expires_in=request.app.state.settings.smartspend_dev_token_minutes * 60,
            user=ProfileView(email=profile.email, display_name=profile.display_name, preferred_currency=profile.preferred_currency, timezone=profile.timezone, theme=profile.theme),
        )

    @application.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT, tags=["authentication"])
    def logout(_: Annotated[dict, Depends(current_claims)]):
        # Cognito sessions are revoked by the frontend Cognito SDK. Local tokens are short-lived and discarded client-side.
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get("/me", response_model=ProfileView, tags=["profile"])
    def read_profile(claims: Annotated[dict, Depends(current_claims)], request: Request):
        subject = claims.get("sub")
        email = claims.get("email")
        if not isinstance(subject, str) or not subject or not isinstance(email, str):
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        return request.app.state.profile_repository.get_or_create(subject, email)

    @application.patch("/me", response_model=ProfileView, tags=["profile"])
    def update_profile(
        patch: ProfilePatch,
        claims: Annotated[dict, Depends(current_claims)],
        request: Request,
    ):
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.profile_repository.update(subject, patch)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Profile not found") from exc

    @application.post("/transactions", response_model=TransactionRecord, status_code=status.HTTP_201_CREATED, tags=["transactions"])
    def create_transaction(
        payload: TransactionCreate,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.transaction_service.create(owner_id, payload, idempotency_key)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="Idempotency key was already used for different transaction data") from exc

    @application.get("/transactions", response_model=TransactionPage, tags=["transactions"])
    def list_transactions(
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        start_date: date | None = None,
        end_date: date | None = None,
        kind: TransactionKind | None = None,
        currency: str | None = Query(default=None, min_length=3, max_length=3),
        category: str | None = Query(default=None, min_length=1, max_length=40),
        search: str | None = Query(default=None, max_length=100),
        cursor: str | None = Query(default=None, max_length=2048),
        limit: int = Query(default=25, ge=1, le=100),
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        if start_date is not None and end_date is not None and end_date < start_date:
            raise HTTPException(status_code=422, detail="end_date must be on or after start_date")
        filters = TransactionFilters(
            start_at=datetime.combine(start_date, time.min, tzinfo=UTC) if start_date else None,
            end_before=datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=UTC) if end_date else None,
            kind=kind,
            currency=currency,
            category=category,
            search=search,
            cursor=cursor,
            limit=limit,
        )
        try:
            return request.app.state.transaction_service.list(owner_id, filters)
        except InvalidCursor as exc:
            raise HTTPException(status_code=422, detail="Invalid pagination cursor") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @application.get("/transactions/{transaction_id}", response_model=TransactionRecord, tags=["transactions"])
    def read_transaction(
        transaction_id: str,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.transaction_service.get(owner_id, transaction_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Transaction not found") from exc

    @application.patch("/transactions/{transaction_id}", response_model=TransactionRecord, tags=["transactions"])
    def update_transaction(
        transaction_id: str,
        patch: TransactionPatch,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.transaction_service.update(owner_id, transaction_id, patch)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Transaction not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail="Transaction changed since it was loaded; refresh and retry") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @application.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["transactions"])
    def delete_transaction(
        transaction_id: str,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        expected_version: int = Query(ge=1),
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            request.app.state.transaction_service.delete(owner_id, transaction_id, expected_version)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Transaction not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail="Transaction changed since it was loaded; refresh and retry") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get("/dashboard", response_model=DashboardSummary, tags=["dashboard"])
    def dashboard(
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        start_date: date | None = None,
        end_date: date | None = None,
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.transaction_service.dashboard(owner_id, start_date, end_date)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @application.post("/recurrences", response_model=RecurringSchedule, status_code=status.HTTP_201_CREATED, tags=["recurrences"])
    def create_recurrence(
        payload: RecurrenceCreate,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.recurrence_service.create(owner_id, payload, idempotency_key)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="Idempotency key was already used for different recurrence data") from exc

    @application.get("/recurrences", response_model=list[RecurringSchedule], tags=["recurrences"])
    def list_recurrences(request: Request, claims: Annotated[dict, Depends(current_claims)]):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        return request.app.state.recurrence_service.list(owner_id)

    @application.post("/recurrences/process-due", response_model=RecurrenceProcessResult, tags=["recurrences"])
    def process_due_recurrences(request: Request, claims: Annotated[dict, Depends(current_claims)]):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        return RecurrenceProcessResult(generated_count=request.app.state.recurrence_service.process_due(owner_id))

    @application.patch("/recurrences/{schedule_id}", response_model=RecurringSchedule, tags=["recurrences"])
    def update_recurrence(
        schedule_id: str,
        patch: RecurrencePatch,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.recurrence_service.set_enabled(owner_id, schedule_id, patch)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Recurring schedule not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail="Recurring schedule changed since it was loaded; refresh and retry") from exc

    @application.delete("/recurrences/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["recurrences"])
    def delete_recurrence(
        schedule_id: str,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        expected_version: int = Query(ge=1),
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            request.app.state.recurrence_service.delete(owner_id, schedule_id, expected_version)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Recurring schedule not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail="Recurring schedule changed since it was loaded; refresh and retry") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post("/budgets", response_model=BudgetRecord, status_code=status.HTTP_201_CREATED, tags=["budgets"])
    def create_budget(
        payload: BudgetCreate,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.budget_service.create(owner_id, payload, idempotency_key)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="Idempotency key was already used for different budget data") from exc

    @application.get("/budgets", response_model=BudgetStatusPage, tags=["budgets"])
    def list_budgets(request: Request, claims: Annotated[dict, Depends(current_claims)]):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        return request.app.state.budget_service.list(owner_id)

    @application.get("/budgets/{budget_id}", response_model=BudgetStatus, tags=["budgets"])
    def read_budget(budget_id: str, request: Request, claims: Annotated[dict, Depends(current_claims)]):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.budget_service.get(owner_id, budget_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Budget not found") from exc

    @application.patch("/budgets/{budget_id}", response_model=BudgetRecord, tags=["budgets"])
    def update_budget(
        budget_id: str,
        patch: BudgetPatch,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.budget_service.update(owner_id, budget_id, patch)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Budget not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail="Budget changed since it was loaded; refresh and retry") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @application.delete("/budgets/{budget_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["budgets"])
    def delete_budget(
        budget_id: str,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        expected_version: int = Query(ge=1),
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            request.app.state.budget_service.delete(owner_id, budget_id, expected_version)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Budget not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail="Budget changed since it was loaded; refresh and retry") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post("/groups", response_model=GroupRecord, status_code=status.HTTP_201_CREATED, tags=["groups"])
    def create_group(
        payload: GroupCreate,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            email = claims.get("email")
            email_claim = email if isinstance(email, str) else None
            return request.app.state.group_service.create(owner_id, payload, idempotency_key, email_claim)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="Idempotency key was already used for different group data") from exc

    @application.get("/groups", response_model=list[GroupRecord], tags=["groups"])
    def list_groups(request: Request, claims: Annotated[dict, Depends(current_claims)]):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        return request.app.state.group_service.list(owner_id)

    @application.get("/groups/{group_id}", response_model=GroupRecord, tags=["groups"])
    def read_group(group_id: str, request: Request, claims: Annotated[dict, Depends(current_claims)]):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.group_service.get(owner_id, group_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Group not found") from exc

    @application.patch("/groups/{group_id}", response_model=GroupRecord, tags=["groups"])
    def update_group(
        group_id: str,
        patch: GroupPatch,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            email = claims.get("email")
            email_claim = email if isinstance(email, str) else None
            return request.app.state.group_service.update(owner_id, group_id, patch, email_claim)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Group not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail="Group changed since it was loaded; refresh and retry") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @application.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["groups"])
    def delete_group(
        group_id: str,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        expected_version: int = Query(ge=1),
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            request.app.state.group_service.delete(owner_id, group_id, expected_version)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Group not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail="Group changed since it was loaded; refresh and retry") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post("/groups/{group_id}/expenses", response_model=GroupExpenseRecord, status_code=status.HTTP_201_CREATED, tags=["groups"])
    def create_expense(
        group_id: str,
        payload: GroupExpenseCreate,
        request: Request,
        claims: Annotated[dict, Depends(current_claims)],
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128)],
    ):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.group_service.create_expense(owner_id, group_id, payload, idempotency_key)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Group not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="Idempotency key was already used for different expense data") from exc

    @application.get("/groups/{group_id}/expenses", response_model=list[GroupExpenseRecord], tags=["groups"])
    def list_group_expenses(group_id: str, request: Request, claims: Annotated[dict, Depends(current_claims)]):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.group_service.list_expenses(owner_id, group_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Group not found") from exc

    @application.get("/groups/{group_id}/settlements", response_model=GroupSettlementSummary, tags=["groups"])
    def group_settlements(group_id: str, request: Request, claims: Annotated[dict, Depends(current_claims)]):
        owner_id = claims.get("sub")
        if not isinstance(owner_id, str) or not owner_id:
            raise HTTPException(status_code=401, detail="Identity token is missing required claims")
        try:
            return request.app.state.group_service.settlement_summary(owner_id, group_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Group not found") from exc

    return application


app = create_app()
lambda_handler = Mangum(app, lifespan="off")
