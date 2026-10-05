# Architecture and milestones

The React SPA talks to a typed REST API. Local development runs the FastAPI app over uvicorn; the same ASGI application is adapted to Lambda by Mangum. The AWS handler verifies Cognito ID-token signatures using Cognito's JWKS and restricts issuer, client audience, token type, expiry, subject, and email. Production profile storage uses DynamoDB; local development uses SQLite. The local email sign-in issues a short-lived development JWT with an explicit local issuer/audience and is rejected when `APP_ENV` is not `local`.

Backend boundaries use Pydantic models for external validation, repositories for storage, a transaction service for financial aggregation, and HTTP/Lambda adapters. Amounts use integer minor units. Client user IDs are never authorization inputs. API CORS is explicit-origin only. Logs include request correlation and exception type only, not profile or financial fields.

1. **Phase 1 (implemented):** authentication boundary, protected profile operations, theme/currency/timezone preferences, tests.
2. **Phase 2 (implemented):** owner-scoped income/expense CRUD, idempotent create, version-checked edit/delete, filters/search/cursor pagination, currency-separated dashboard totals, Recharts trends, and tests. Recurring schedule generation remains pending.
3. **Phase 3 (implemented):** monthly/custom period and category budgets, live spending progress, versioned CRUD, and in-app threshold status. Outbound notifications remain pending.
4. Phase 4: groups/memberships, equal/custom shares, group currency invariant, balances, settlement history, and netting.
5. Phase 5: private reports, charts, CSV export, and settings completion.
6. Phase 6: full SAM deployment, least-privilege policies, backups/deletion behavior, integration/security tests, and environment-specific rollout.

A net settlement plan is one valid plan and may not be unique. A settlement is only completed after an explicit payment record; viewing a settlement never changes its status. AWS use can incur charges. No regulatory compliance is asserted.