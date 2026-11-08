import { request } from './api';

export type TransactionKind = 'income' | 'expense';
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other';
export type Transaction = {
  transaction_id: string;
  kind: TransactionKind;
  amount_minor: number;
  currency: string;
  category: string;
  occurred_at: string;
  notes: string | null;
  payment_method: PaymentMethod | null;
  created_at: string;
  updated_at: string;
  version: number;
};
export type TransactionDraft = Omit<Transaction, 'transaction_id' | 'created_at' | 'updated_at' | 'version'>;
export type TransactionPatch = Partial<TransactionDraft> & { expected_version: number };
export type TransactionPage = { items: Transaction[]; next_cursor: string | null };
export type CurrencyTotals = { currency: string; income_minor: number; expense_minor: number; balance_minor: number };
export type CategoryTotals = { currency: string; category: string; expense_minor: number };
export type MonthlyTrend = { month: string; currency: string; income_minor: number; expense_minor: number };
export type DashboardSummary = {
  range_start: string;
  range_end: string;
  timezone: string;
  currencies: CurrencyTotals[];
  category_totals: CategoryTotals[];
  monthly_trend: MonthlyTrend[];
  recent_transactions: Transaction[];
};
export type TransactionFilters = {
  start_date?: string;
  end_date?: string;
  kind?: TransactionKind | '';
  currency?: string;
  category?: string;
  search?: string;
  limit?: number;
  cursor?: string;
};
export type BudgetPeriodType = 'monthly' | 'custom';
export type BudgetDraft = {
  name: string;
  period_type: BudgetPeriodType;
  start_date: string;
  end_date: string;
  currency: string;
  total_limit_minor: number | null;
  category_limits: Record<string, number>;
  alert_threshold_percent: number;
};
export type BudgetPatch = Pick<BudgetDraft, 'name' | 'total_limit_minor' | 'category_limits' | 'alert_threshold_percent'> & { expected_version: number };
export type Budget = BudgetDraft & {
  budget_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};
export type BudgetCategoryProgress = {
  category: string;
  limit_minor: number;
  spent_minor: number;
  remaining_minor: number;
  percent_used: number;
  threshold_reached: boolean;
};
export type BudgetStatus = Omit<Budget, 'created_at' | 'updated_at'> & { categories: BudgetCategoryProgress[] };
export type BudgetStatusPage = { items: BudgetStatus[] };

export type GroupRecord = {
  group_id: string;
  name: string;
  description: string | null;
  currency: string;
  members: string[];
  created_at: string;
  updated_at: string;
  version: number;
};
export type GroupDraft = {
  name: string;
  description: string | null;
  currency: string;
  members: string[];
};
export type GroupPatch = {
  expected_version: number;
  name?: string;
  description?: string | null;
  members?: string[];
};
export type GroupExpenseDraft = {
  description: string;
  amount_minor: number;
  currency: string;
  paid_by: string;
  split_type: 'equal' | 'custom';
  splits: Record<string, number> | null;
  occurred_at: string;
};
export type GroupExpense = {
  expense_id: string;
  group_id: string;
  description: string;
  amount_minor: number;
  currency: string;
  paid_by: string;
  split_type: 'equal' | 'custom';
  splits: Record<string, number>;
  occurred_at: string;
  created_at: string;
  updated_at: string;
  version: number;
};
export type GroupBalance = { member_id: string; net_minor: number };
export type GroupSettlement = { from_member: string; to_member: string; amount_minor: number };
export type GroupSettlementSummary = {
  group_id: string;
  currency: string;
  members: string[];
  balances: GroupBalance[];
  settlements: GroupSettlement[];
  expenses: GroupExpense[];
};
export type RecurrenceFrequency = 'weekly' | 'monthly';
export type RecurringSchedule = {
  schedule_id: string;
  description: string;
  amount_minor: number;
  currency: string;
  category: string;
  notes: string | null;
  payment_method: PaymentMethod | null;
  frequency: RecurrenceFrequency;
  interval: number;
  starts_on: string;
  ends_on: string | null;
  next_occurrence_on: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  version: number;
};
export type RecurrenceDraft = {
  description: string;
  amount_minor: number;
  currency: string;
  category: string;
  notes: string | null;
  payment_method: PaymentMethod | null;
  frequency: RecurrenceFrequency;
  interval: number;
  starts_on: string;
  ends_on: string | null;
};

export const currencyExponent: Record<string, number> = {
  USD: 2, CAD: 2, EUR: 2, GBP: 2, AUD: 2, NZD: 2, JPY: 0,
};

export function decimalToMinorUnits(value: string, currency: string): number {
  const exponent = currencyExponent[currency];
  if (exponent === undefined) throw new Error('Choose a supported currency.');
  const match = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a valid positive amount.');
  const [whole, fraction = ''] = value.trim().split('.');
  if (fraction.length > exponent) throw new Error(`${currency} accepts at most ${exponent} decimal places.`);
  const scale = 10n ** BigInt(exponent);
  const minor = BigInt(whole) * scale + BigInt((fraction + '0'.repeat(exponent)).slice(0, exponent) || '0');
  if (minor <= 0n) throw new Error('Enter a valid positive amount.');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is outside the supported range.');
  return Number(minor);
}

export function minorUnitsToInput(amountMinor: number, currency: string): string {
  const exponent = currencyExponent[currency];
  if (exponent === undefined) return '';
  const scale = 10 ** exponent;
  return exponent === 0 ? String(amountMinor) : (amountMinor / scale).toFixed(exponent);
}

export function formatMoney(amountMinor: number, currency: string): string {
  const exponent = currencyExponent[currency] ?? 2;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent })
    .format(amountMinor / 10 ** exponent);
}

export function dateInTimezone(isoDateTime: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(isoDateTime));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function localDateAtNoonUtcInput(value: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Enter a valid date.');
  const [, year, month, day] = match;
  const targetUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), 12);
  let guess = targetUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const representedUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    guess += targetUtc - representedUtc;
  }
  const result = new Date(guess);
  if (Number.isNaN(result.getTime())) throw new Error('Enter a valid date.');
  return result.toISOString();
}

export const financeApi = {
  listTransactions(token: string, filters: TransactionFilters) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return request<TransactionPage>(`/transactions${query.size ? `?${query.toString()}` : ''}`, token);
  },
  createTransaction(token: string, draft: TransactionDraft, idempotencyKey: string) {
    return request<Transaction>('/transactions', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(draft),
    });
  },
  updateTransaction(token: string, transactionId: string, patch: TransactionPatch) {
    return request<Transaction>(`/transactions/${encodeURIComponent(transactionId)}`, token, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
  },
  deleteTransaction(token: string, transactionId: string, expectedVersion: number) {
    const query = new URLSearchParams({ expected_version: String(expectedVersion) });
    return request<void>(`/transactions/${encodeURIComponent(transactionId)}?${query.toString()}`, token, { method: 'DELETE' });
  },
  dashboard(token: string, startDate: string, endDate: string) {
    const query = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return request<DashboardSummary>(`/dashboard?${query.toString()}`, token);
  },
  listBudgets(token: string) {
    return request<BudgetStatusPage>('/budgets', token);
  },
  createBudget(token: string, draft: BudgetDraft, idempotencyKey: string) {
    return request<Budget>('/budgets', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(draft),
    });
  },
  updateBudget(token: string, budgetId: string, patch: BudgetPatch) {
    return request<Budget>(`/budgets/${encodeURIComponent(budgetId)}`, token, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
  },
  deleteBudget(token: string, budgetId: string, expectedVersion: number) {
    const query = new URLSearchParams({ expected_version: String(expectedVersion) });
    return request<void>(`/budgets/${encodeURIComponent(budgetId)}?${query.toString()}`, token, { method: 'DELETE' });
  },
  listGroups(token: string) {
    return request<GroupRecord[]>('/groups', token);
  },
  createGroup(token: string, draft: GroupDraft, idempotencyKey: string) {
    return request<GroupRecord>('/groups', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(draft),
    });
  },
  updateGroup(token: string, groupId: string, patch: GroupPatch) {
    return request<GroupRecord>(`/groups/${encodeURIComponent(groupId)}`, token, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
  },
  deleteGroup(token: string, groupId: string, expectedVersion: number) {
    const query = new URLSearchParams({ expected_version: String(expectedVersion) });
    return request<void>(`/groups/${encodeURIComponent(groupId)}?${query.toString()}`, token, { method: 'DELETE' });
  },
  listGroupExpenses(token: string, groupId: string) {
    return request<GroupExpense[]>(`/groups/${encodeURIComponent(groupId)}/expenses`, token);
  },
  createGroupExpense(token: string, groupId: string, draft: GroupExpenseDraft, idempotencyKey: string) {
    return request<GroupExpense>(`/groups/${encodeURIComponent(groupId)}/expenses`, token, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(draft),
    });
  },
  settlementSummary(token: string, groupId: string) {
    return request<GroupSettlementSummary>(`/groups/${encodeURIComponent(groupId)}/settlements`, token);
  },
  listRecurrences(token: string) {
    return request<RecurringSchedule[]>('/recurrences', token);
  },
  processDueRecurrences(token: string) {
    return request<{ generated_count: number }>('/recurrences/process-due', token, { method: 'POST' });
  },
  createRecurrence(token: string, draft: RecurrenceDraft, idempotencyKey: string) {
    return request<RecurringSchedule>('/recurrences', token, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(draft),
    });
  },
  updateRecurrence(token: string, scheduleId: string, patch: { expected_version: number; enabled: boolean }) {
    return request<RecurringSchedule>(`/recurrences/${encodeURIComponent(scheduleId)}`, token, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
  },
  deleteRecurrence(token: string, scheduleId: string, expectedVersion: number) {
    const query = new URLSearchParams({ expected_version: String(expectedVersion) });
    return request<void>(`/recurrences/${encodeURIComponent(scheduleId)}?${query.toString()}`, token, { method: 'DELETE' });
  },
};
