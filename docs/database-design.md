# Database access patterns

## Implemented in Phases 1–3

The profile table uses `subject` as its partition key. Reads and writes are always keyed by the subject from a verified token; the client cannot supply it. Local SQLite stores profiles and transactions; passwords and authentication tokens are not persisted by this service.

The transactions table uses `owner_id` (PK) and `transaction_id` (SK) for owner-scoped point reads, updates, and deletes. `OwnerOccurredAtIndex` uses `owner_id` (PK) and `occurred_sort_key` (SK) for newest-first date-range lists and dashboard aggregation. Kind, currency, category, and text search are filter expressions over the owner/date query. Only the date index is a DynamoDB query key in this phase. Amounts are strictly positive integer minor units. Supported currencies are USD, CAD, EUR, GBP, AUD, NZD (2 digits) and JPY (0 digits); no conversion is performed. `occurred_at`, `created_at`, and `updated_at` are normalized to UTC.

The idempotency table uses `owner_operation` (PK), `idempotency_key` (SK), `payload_hash`, and `transaction_id`. The transaction and idempotency record are committed in one DynamoDB transaction. Reusing the same key and body returns the original record; a different body returns a conflict. Idempotency entries expire after 30 days. SQLite has equivalent owner-bound transaction/idempotency tables. Updates and deletes require an `expected_version` conditional write.

Budgets use `owner_id` (PK) and `budget_id` (SK). Their category limits are stored as normalized category-to-integer-minor-unit maps. Status is computed from owner-scoped expense transactions in the same currency and inclusive UTC date range; it is not a separately persisted snapshot. Budget and idempotency records are atomically created in DynamoDB, and budget mutations use conditional versions.

## Planned DynamoDB model

Use separate tables during initial delivery to keep security boundaries visible:

| Table | Primary key | Planned indexes / access patterns |
|---|---|---|
| Users | `subject` (PK) | Direct authenticated profile lookup |
| Transactions (implemented) | `owner_id` (PK), `transaction_id` (SK) | GSI `OwnerOccurredAtIndex`: `owner_id` (PK), `occurred_sort_key` (SK) for date-range/list order. Direct mutations use the base key; other filters apply to the owner/date query. |
| Budgets (implemented) | `owner_id` (PK), `budget_id` (SK) | Owner query for list; date and currency filtering are applied in the service |
| Groups | `group_id` (PK) | Group metadata and currency |
| Memberships | `group_id` (PK), `member_id` (SK) | GSI `member_id` (PK), `group_id` (SK) for a user's groups |
| SharedExpenses | `group_id` (PK), `occurred_at#expense_id` (SK) | GSI `group_id + expense_id` for mutation; store immutable participant shares |
| Settlements | `group_id` (PK), `created_at#settlement_id` (SK) | GSI `group_id + status#created_at`; status history |
| Idempotency (implemented) | `owner_operation` (PK), `idempotency_key` (SK) | Atomic create with transaction item; 30-day TTL and payload-hash comparison |

All amounts are integer minor currency units with explicit currency. Transaction timestamps are persisted in UTC; transaction date filters and dashboard boundaries use UTC calendar dates, while display uses the profile timezone. A group will have one currency; mixed-currency operations will be rejected unless conversion is deliberately implemented. Transaction ownership and group membership must be checked on every read/write. Transaction create uses `TransactWriteItems`; edit/delete use conditional version checks. Financial records are not automatically expired; explicit transaction deletes are hard deletes. Backup/PITR and user deletion/anonymization retention remain deployment decisions. The current cost-conscious SAM tables disable point-in-time recovery and are deleted with their stack.

Recurring schedules are not implemented yet; entries in this phase are one-off and do not generate future records.