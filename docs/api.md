# API contract

Base URL defaults to `http://localhost:8000`. JSON errors use `{"error":{"code":"...","message":"...","fields":[]}}` for validation errors. Every response includes an `X-Request-ID`. Requests accept no user ID for identity; the subject is taken from a verified bearer token.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Local/API health | No |
| POST | `/auth/dev-login` | Issue short-lived dev-only token for email | Local only |
| POST | `/auth/logout` | Validate active identity; client discards/revokes session | Yes |
| GET | `/me` | Read or initialize current profile | Yes |
| PATCH | `/me` | Update display name, currency, timezone, or theme | Yes |
| GET | `/dashboard` | UTC date-scoped income, expense, category, monthly trend, and recent transaction summary | Yes |
| POST | `/budgets` | Create an owner-scoped budget with an `Idempotency-Key` | Yes |
| GET | `/budgets` | List the current owner's budgets with live expense progress | Yes |
| GET | `/budgets/{budget_id}` | Read one owned budget with live progress | Yes |
| PATCH | `/budgets/{budget_id}` | Update name/limits/threshold with required `expected_version` | Yes |
| DELETE | `/budgets/{budget_id}?expected_version=N` | Permanently delete with an expected version | Yes |
| GET | `/transactions` | Owner-scoped transactions with date, kind, currency, category, search, and cursor filters | Yes |
| POST | `/transactions` | Create one income/expense using integer minor units and an `Idempotency-Key` header | Yes |
| GET | `/transactions/{transaction_id}` | Read one owned transaction | Yes |
| PATCH | `/transactions/{transaction_id}` | Edit with required `expected_version` | Yes |
| DELETE | `/transactions/{transaction_id}?expected_version=N` | Permanently delete with an expected version | Yes |

Create requires `kind` (`income` or `expense`), positive integer `amount_minor`, explicit supported `currency`, `category`, and a timezone-aware ISO `occurred_at`; `notes` and `payment_method` are optional. Supported currencies are USD, CAD, EUR, GBP, AUD, NZD, and JPY. Timestamps are normalized to UTC. The UI interprets calendar dates in the profile timezone and sends noon in that timezone to avoid midnight/DST boundary ambiguity. List date filters are UTC calendar dates; `end_date` is inclusive. Dashboard defaults to the current UTC month, allows a maximum 366-day range, and returns separate totals per currency without conversion.

`GET /transactions` returns `{items, next_cursor}` without a total count. The cursor is opaque; the authenticated owner is always derived from the token. Create idempotency keys are retained for 30 days; a retry with the same key/body returns the original record, while a changed body returns `409`. Updates/deletes with a stale version return `409`. Deletes are permanent in this phase. Recurrence is not implemented; entries do not auto-repeat.

Cognito operations (sign-up, confirmation, sign-in, password reset, and sign-out) are performed by the Amplify Auth SDK against the configured Cognito User Pool. The API accepts Cognito **ID tokens** and verifies RS256 signature against the pool JWKS, issuer, client audience, expiry, token-use claim, subject, and email. Local tokens are HS256-signed using a development-only secret and are accepted only when `APP_ENV=local`.

PATCH rejects unknown fields and does not allow changing email or subject. CORS allowlists explicit origins only. Do not expose validation input values or tokens in logs.

## Budgets

Create requires `name`, `period_type` (`monthly` or `custom`), inclusive `start_date` and `end_date`, `currency`, and at least one of `total_limit_minor` or `category_limits`. Monthly budgets cover one complete UTC calendar month. Custom periods may cover at most 366 inclusive days. Category keys are trimmed and case-folded, and no more than 20 category limits are allowed. Each amount is a positive integer in the selected currency's minor units. `alert_threshold_percent` defaults to 80 and must be 50–100. Budget creation idempotency follows the same 30-day owner-scoped retry behavior as transactions.

`GET /budgets` returns `{items}`. Each status includes `categories`, with one entry named `all spending` for an overall limit (when configured) and one entry per category limit. Progress reports `spent_minor`, `remaining_minor` (which may be negative), integer `percent_used`, and `threshold_reached`. Spending includes only expense transactions in the same currency and inclusive UTC date range; income and other currencies are excluded. Category names use the normalized transaction category. PATCH supports `name`, `total_limit_minor`, `category_limits`, and `alert_threshold_percent`; send explicit `null` for `total_limit_minor` to remove the overall limit, but at least one limit must remain. Schedule dates, period type, and currency are immutable after creation. A stale version returns `409`. Threshold state is displayed in the application; outbound notifications are not implemented.