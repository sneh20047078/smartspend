# SmartSpend

SmartSpend is a personal finance and group expense application. This repository is being delivered in verified phases; **Phases 1–3 are implemented**: authentication/profile, owner-scoped income/expense transactions and date-scoped dashboard summaries, and versioned owner-scoped budgets with expense progress. Budget threshold state is shown in-app; outbound notifications, groups, settlements, reports, recurrence, and production deployment remain planned.

## Architecture

- `frontend/`: React, TypeScript, Vite, Tailwind CSS v4, shadcn/ui component conventions, React Router, Recharts, Amplify Auth (Cognito), Vitest, and Testing Library.
- `backend/`: Python 3.12, FastAPI local adapter, Pydantic v2, SQLite profile/transaction persistence for local development, Cognito JWT validation, and a Lambda-compatible handler.
- `infrastructure/`: AWS SAM template for Cognito, HTTP API, Lambda, profile/transaction/idempotency DynamoDB tables (foundation only).
- `docs/`: architecture, data access patterns, and API contract.

Production authentication delegates credentials and password handling to Amazon Cognito. The local-only sign-in is a developer convenience: it accepts an email, creates no password, and must never be enabled in deployed environments. Local profiles persist in a SQLite file; the local identity token secret is for development only.

## Prerequisites

- Node.js 20+
- Python 3.12
- npm

## Run locally

Use two PowerShell terminals from the repository root. First configure the local-only backend:

1. Copy `backend/.env.example` to `backend/.env` and replace `SMARTSPEND_DEV_JWT_SECRET` with a random value of at least 32 characters. Keep `APP_ENV=local`; never reuse this secret elsewhere.
2. In the first terminal:

	```powershell
	py -3.12 -m venv backend/.venv
	& backend/.venv/Scripts/Activate.ps1
	Set-Location backend
	python -m pip install -e ".[dev]"
	python -m uvicorn app.main:app --reload
	```

3. Copy `frontend/.env.example` to `frontend/.env.local`. Leave the Cognito values blank for local mode and keep `VITE_API_BASE_URL=http://localhost:8000`.
4. In the second terminal:

	```powershell
	Set-Location frontend
	npm install
	npm run dev
	```

5. Open the Vite URL printed by the frontend server. Local sign-in accepts an email only and is intentionally not real authentication. It creates no password and stores profile and transaction data in `backend/smartspend-local.sqlite3`.

## Tests

- Run the complete local test/build check from the root with `powershell -ExecutionPolicy Bypass -File .\\scripts\\test.ps1` (requires frontend npm dependencies and the backend dev dependencies installed).
- Backend only: from `backend/`, run `python -m pytest`.
- Frontend only: from `frontend/`, run `npm test` and `npm run build`.

## Project layout

```text
frontend/       React app, auth/profile UX, API client, component primitives, tests
backend/        FastAPI/Lambda app, Cognito verification, repositories, tests
infrastructure/ AWS SAM Cognito/API/Lambda/profile/transaction-table template
docs/           API, architecture, database access patterns, deployment notes
scripts/        Local cross-stack test/build runner
```

## AWS/Cognito foundation

See [infrastructure/template.yaml](infrastructure/template.yaml) and [docs/deployment.md](docs/deployment.md). Production mode requires the Cognito User Pool ID, app client ID, AWS region, and table names; the API validates Cognito ID-token signatures against the pool JWKS. Cognito handles registration confirmation, login, sign-out, and password reset. Never put AWS credentials or signing secrets in frontend variables. AWS deployment and usage can incur charges. The SAM template is a development foundation and is not yet a complete SmartSpend production deployment.

## Data safety

Phase 2 transactions use positive integer minor units and explicit supported currencies, UTC timestamps, owner-scoped access, idempotency keys, and conditional version writes. Dashboard totals remain separated by currency. Recurring transaction generation is not yet implemented. Do not enter real financial data into local development mode. No compliance certification is claimed.

## Roadmap / completion status

- [x] Phase 1: authentication boundary, local-only dev identity, profile read/update, frontend protected shell, tests.
- [x] Phase 2: transaction CRUD, idempotency/version checks, filters/search/pagination, and data-backed dashboard summaries/charts.
- [ ] Recurring expense schedules and automatic occurrence generation.
- [x] Phase 3: monthly/custom budgets, category and overall thresholds, live spending progress, CRUD, and tests.
- [ ] Phase 4: groups, expenses, split calculation, settlement history and debt netting.
- [ ] Phase 5: reports, privacy-scoped CSV export, settings.
- [ ] Phase 6: full DynamoDB model, least-privilege policies, deployment hardening and end-to-end AWS verification.

Features are marked complete only after implementation and verification.