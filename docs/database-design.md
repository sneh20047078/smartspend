# Database access patterns

## Implemented persistence behavior

The profile table uses `subject` as its partition key. Reads and writes are always keyed by the subject from a verified token; the client cannot supply it. Local SQLite stores profiles, transactions, budgets, recurring schedules, groups, shared expenses, and local password hashes. Plaintext passwords and authentication tokens are not persisted by this service.

The transactions table uses `owner_id` (PK) and `transaction_id` (SK) for owner-scoped point reads, updates, and deletes. `OwnerOccurredAtIndex` uses `owner_id` (PK) and `occurred_sort_key` (SK) for newest-first date-range lists and dashboard aggregation. Kind, currency, category, and text search are filter expressions over the owner/date query. Only the date index is a DynamoDB query key in this phase. Amounts are strictly positive integer minor units. Supported currencies are USD, CAD, EUR, GBP, AUD, NZD (2 digits) and JPY (0 digits); no conversion is performed. `occurred_at`, `created_at`, and `updated_at` are normalized to UTC.

The idempotency table uses `owner_operation` (PK), `idempotency_key` (SK), `payload_hash`, resource type/ID, and a 30-day TTL. Transaction, budget, group, and group-expense creates commit the idempotency item atomically with the new record. Reusing the same key and body returns the original record; a different body returns a conflict. SQLite has equivalent owner-bound idempotency records. Versioned mutations require an `expected_version` conditional write.

Budgets use `owner_id` (PK) and `budget_id` (SK). Their category limits are stored as normalized category-to-integer-minor-unit maps. Status is computed from owner-scoped expense transactions in the same currency and inclusive UTC date range; it is not a separately persisted snapshot. Budget and idempotency records are atomically created in DynamoDB, and budget mutations use conditional versions.

Recurring schedules use `owner_id` (PK) and `schedule_id` (SK), with a UTC next-occurrence date, frequency/interval, expense template, enabled state, and optimistic version. Due occurrences are written to the regular transaction store with a deterministic idempotency key derived from schedule and occurrence date, then the schedule cursor advances. This makes retries safe after an interrupted request. In local mode generation is lazy and occurs when the authenticated app session opens or the owner lists schedules; it does not run while the app is closed. AWS event scheduling/background execution is not configured.

Groups and shared expenses use owner-scoped SQLite in local mode and owner-partitioned DynamoDB in AWS mode. `Groups` uses `owner_id` (PK) and `group_id` (SK); `SharedExpenses` uses `owner_id` (PK) and `group_sort_key` (SK, prefixed with the group ID and followed by UTC occurrence time and expense ID). Group members are normalized ledger identifiers; the authenticated owner is represented by the email claim from the verified token, but member labels grant no access. Expenses are restricted to the group's currency and persist integer-minor-unit shares. Balance and settlement summaries are derived from the group's expense ledger; settlements are suggestions, not payment records. DynamoDB writes use transactions/conditional checks for idempotent expense creation and group ownership.

Reports and CSV export read existing owner-scoped transaction APIs; no separate report or export dataset is persisted. The UI follows opaque transaction cursors until all records in the chosen UTC range are retrieved. CSV is generated client-side, excludes profile identifiers, and neutralizes spreadsheet-formula-leading text values.

## DynamoDB model and remaining deployment work

Use separate tables during initial delivery to keep security boundaries visible:

| Table | Primary key | Access patterns / indexes |
|---|---|---|
| Profiles (implemented) | `subject` (PK) | Direct authenticated profile lookup |
| Transactions (implemented) | `owner_id` (PK), `transaction_id` (SK) | GSI `OwnerOccurredAtIndex`: `owner_id` (PK), `occurred_sort_key` (SK) for date-range/list order. Direct mutations use the base key; other filters apply to the owner/date query. |
| Budgets (implemented) | `owner_id` (PK), `budget_id` (SK) | Owner query for list; date and currency filtering are applied in the service |
| Groups (implemented) | `owner_id` (PK), `group_id` (SK) | Owner-only group lookup and list |
| SharedExpenses (implemented) | `owner_id` (PK), `group_sort_key` (SK) | Prefix query by group and deterministic newest-first expense order |
| RecurringSchedules (implemented) | `owner_id` (PK), `schedule_id` (SK) | Owner-scoped schedule list and versioned pause/resume/delete |
| Memberships / Settlements | Not separate tables | Member labels are not access grants; settlement plans are calculated from expenses and are not payment records |
| Idempotency (implemented) | `owner_operation` (PK), `idempotency_key` (SK) | Atomic create with transaction item; 30-day TTL and payload-hash comparison |

All amounts are integer minor currency units with explicit currency. Transaction timestamps are persisted in UTC; transaction date filters and dashboard boundaries use UTC calendar dates, while display uses the profile timezone. A group has one currency; mixed-currency operations are rejected unless conversion is deliberately implemented. Transaction and group operations are scoped to the verified owner subject; group member labels do not imply shared API access. Transaction and group expense creates use `TransactWriteItems`; mutations use conditional version checks. Financial records are not automatically expired; explicit deletes are hard deletes. The SAM template enables PITR and retains financial tables on stack deletion/replacement; operators must manage retained resources and backups deliberately.
