import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import {
  currencyExponent,
  dateInTimezone,
  decimalToMinorUnits,
  financeApi,
  formatMoney,
  localDateAtNoonUtcInput,
  minorUnitsToInput,
  type PaymentMethod,
  type Transaction,
  type TransactionDraft,
  type TransactionKind,
  type TransactionFilters,
} from '../lib/finance';

const expenseCategories = ['food', 'groceries', 'housing', 'transport', 'utilities', 'health', 'shopping', 'entertainment', 'travel', 'other'];
const incomeCategories = ['salary', 'freelance', 'gift', 'investment', 'refund', 'other'];
const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: 'card', label: 'Card' }, { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'other', label: 'Other' },
];

type FormState = {
  kind: TransactionKind;
  amount: string;
  currency: string;
  category: string;
  occurredDate: string;
  notes: string;
  paymentMethod: PaymentMethod | '';
};

function todayForTimezone(timezone: string): string {
  return dateInTimezone(new Date().toISOString(), timezone);
}

function blankForm(currency: string, timezone: string): FormState {
  return { kind: 'expense', amount: '', currency, category: '', occurredDate: todayForTimezone(timezone), notes: '', paymentMethod: '' };
}

export function TransactionsPage() {
  const { token, user } = useAuth();
  const [items, setItems] = useState<Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<TransactionFilters>({ limit: 20 });
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState<FormState>(() => blankForm(user?.preferred_currency || 'USD', user?.timezone || 'UTC'));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const idempotency = useRef({ signature: '', key: '' });

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    financeApi.listTransactions(token, { ...appliedFilters, cursor })
      .then(page => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.next_cursor);
      })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Transactions could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, appliedFilters, cursor, refresh]);

  function openCreate() {
    setEditing(null);
    setForm(blankForm(user?.preferred_currency || 'USD', user?.timezone || 'UTC'));
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(transaction: Transaction) {
    setEditing(transaction);
    setForm({
      kind: transaction.kind,
      amount: minorUnitsToInput(transaction.amount_minor, transaction.currency),
      currency: transaction.currency,
      category: transaction.category,
      occurredDate: dateInTimezone(transaction.occurred_at, user?.timezone || 'UTC'),
      notes: transaction.notes || '',
      paymentMethod: transaction.payment_method || '',
    });
    setFormError('');
    setDialogOpen(true);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setFormError('');
    try {
      const draft: TransactionDraft = {
        kind: form.kind,
        amount_minor: decimalToMinorUnits(form.amount, form.currency),
        currency: form.currency,
        category: form.category.trim().toLowerCase(),
        occurred_at: localDateAtNoonUtcInput(form.occurredDate, user?.timezone || 'UTC'),
        notes: form.notes.trim() || null,
        payment_method: form.paymentMethod || null,
      };
      if (editing) {
        await financeApi.updateTransaction(token, editing.transaction_id, { ...draft, expected_version: editing.version });
        setSuccess('Transaction updated.');
      } else {
        const signature = JSON.stringify(draft);
        if (idempotency.current.signature !== signature) {
          idempotency.current = { signature, key: crypto.randomUUID() };
        }
        await financeApi.createTransaction(token, draft, idempotency.current.key);
        idempotency.current = { signature: '', key: '' };
        setSuccess('Transaction added.');
      }
      setDialogOpen(false);
      setEditing(null);
      setCursor(undefined);
      setCursorHistory([]);
      setRefresh(value => value + 1);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Transaction could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(transaction: Transaction) {
    if (!token || !window.confirm(`Delete this ${transaction.kind} transaction? This cannot be undone.`)) return;
    setSuccess('');
    try {
      await financeApi.deleteTransaction(token, transaction.transaction_id, transaction.version);
      setSuccess('Transaction deleted.');
      setRefresh(value => value + 1);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Transaction could not be deleted.');
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextFilters: TransactionFilters = { limit: 20 };
    for (const field of ['start_date', 'end_date', 'kind', 'currency', 'category', 'search'] as const) {
      const value = String(data.get(field) || '').trim();
      if (value) Object.assign(nextFilters, { [field]: value });
    }
    setAppliedFilters(nextFilters);
    setCursor(undefined);
    setCursorHistory([]);
  }

  function goNext() {
    if (!nextCursor) return;
    setCursorHistory(history => [...history, cursor || '']);
    setCursor(nextCursor);
  }

  function goPrevious() {
    if (!cursorHistory.length) return;
    const previous = cursorHistory[cursorHistory.length - 1];
    setCursorHistory(history => history.slice(0, -1));
    setCursor(previous || undefined);
  }

  const categories = form.kind === 'expense' ? expenseCategories : incomeCategories;
  return <div className="space-y-7">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-sm font-medium text-muted">Income and expenses</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Transactions</h1><p className="mt-2 text-sm text-muted">Amounts are stored in minor units and always retain their currency.</p></div>
      <Button onClick={openCreate}><Plus size={17} /> Add transaction</Button>
    </div>

    <form onSubmit={applyFilters} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-7 lg:items-end">
      <div className="space-y-1.5"><label htmlFor="filter-kind" className="block text-xs font-semibold text-slate-600">Type</label><select id="filter-kind" name="kind" defaultValue={appliedFilters.kind || ''} className="field"><option value="">All types</option><option value="expense">Expenses</option><option value="income">Income</option></select></div>
      <TextField label="From (UTC date)" type="date" name="start_date" defaultValue={appliedFilters.start_date} />
      <TextField label="To (UTC date)" type="date" name="end_date" defaultValue={appliedFilters.end_date} />
      <div className="space-y-1.5"><label htmlFor="filter-currency" className="block text-xs font-semibold text-slate-600">Currency</label><select id="filter-currency" name="currency" defaultValue={appliedFilters.currency || ''} className="field"><option value="">All currencies</option>{Object.keys(currencyExponent).map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></div>
      <TextField label="Category" name="category" defaultValue={appliedFilters.category} placeholder="e.g. groceries" />
      <div className="space-y-1.5"><label htmlFor="filter-search" className="block text-xs font-semibold text-slate-600">Search</label><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input id="filter-search" name="search" defaultValue={appliedFilters.search} className="field pl-9" placeholder="Notes or category" /></div></div>
      <Button type="submit" variant="ghost" className="border border-slate-200">Apply filters</Button>
    </form>

    {loadError && <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{loadError}</span><button aria-label="Dismiss error" onClick={() => setLoadError('')}><X size={16} /></button></div>}
    {success && <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>{success}</span><button aria-label="Dismiss notification" onClick={() => setSuccess('')}><X size={16} /></button></div>}

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="transaction-list-heading">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 id="transaction-list-heading" className="font-bold text-ink">All transactions</h2><p className="mt-1 text-xs text-muted">Dates are stored in UTC and displayed in {user?.timezone || 'UTC'}.</p></div><span className="text-xs font-medium text-slate-500">{loading ? 'Loading…' : `${items.length} shown`}</span></div>
      {loading ? <div className="animate-pulse space-y-4 p-6" aria-label="Loading transactions">{[1, 2, 3].map(row => <div key={row} className="h-12 rounded-lg bg-slate-100" />)}</div> : items.length === 0 ? <div className="px-6 py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand"><Search size={20} /></div><h3 className="mt-4 font-bold text-ink">No transactions found</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted">Add an income or expense, or adjust your filters. SmartSpend never inserts sample financial data.</p><Button className="mt-5" onClick={openCreate}><Plus size={16} /> Add transaction</Button></div> : <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">Your income and expense transactions</caption>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th scope="col" className="px-5 py-3 font-semibold">Transaction</th><th scope="col" className="px-5 py-3 font-semibold">Date</th><th scope="col" className="px-5 py-3 font-semibold">Type</th><th scope="col" className="px-5 py-3 text-right font-semibold">Amount</th><th scope="col" className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{items.map(transaction => <tr key={transaction.transaction_id} className="hover:bg-slate-50/70">
            <td className="px-5 py-4"><p className="font-semibold capitalize text-ink">{transaction.category}</p><p className="mt-1 max-w-xs truncate text-xs text-muted">{transaction.notes || (transaction.payment_method ? paymentMethods.find(method => method.value === transaction.payment_method)?.label : 'No notes')}</p></td>
            <td className="whitespace-nowrap px-5 py-4 text-slate-600">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: user?.timezone || 'UTC' }).format(new Date(transaction.occurred_at))}</td>
            <td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${transaction.kind === 'income' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{transaction.kind === 'income' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}{transaction.kind === 'income' ? 'Income' : 'Expense'}</span></td>
            <td className={`whitespace-nowrap px-5 py-4 text-right font-bold tabular-nums ${transaction.kind === 'income' ? 'text-emerald-700' : 'text-slate-800'}`}>{transaction.kind === 'income' ? '+' : '−'}{formatMoney(transaction.amount_minor, transaction.currency)}</td>
            <td className="whitespace-nowrap px-5 py-4 text-right"><button onClick={() => openEdit(transaction)} aria-label={`Edit ${transaction.category}`} className="rounded-lg p-2 text-slate-500 hover:bg-indigo-50 hover:text-brand"><Pencil size={16} /></button><button onClick={() => void remove(transaction)} aria-label={`Delete ${transaction.category}`} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><span className="text-xs text-slate-500">Page size: 20</span><div className="flex gap-2"><Button variant="ghost" className="border border-slate-200 px-3 py-2" disabled={!cursorHistory.length || loading} onClick={goPrevious}><ChevronLeft size={16} /> Previous</Button><Button variant="ghost" className="border border-slate-200 px-3 py-2" disabled={!nextCursor || loading} onClick={goNext}>Next <ChevronRight size={16} /></Button></div></div>
    </section>

    {dialogOpen && <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="transaction-form-title" className="my-8 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between"><div><h2 id="transaction-form-title" className="text-xl font-bold text-ink">{editing ? 'Edit transaction' : 'Add transaction'}</h2><p className="mt-1 text-sm text-muted">Enter a positive amount. Its currency is saved with the record.</p></div><button onClick={() => setDialogOpen(false)} aria-label="Close transaction form" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
        <form onSubmit={submitForm} className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><label htmlFor="transaction-kind" className="block text-sm font-semibold text-slate-700">Type</label><select id="transaction-kind" className="field" value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as TransactionKind, category: '' }))}><option value="expense">Expense</option><option value="income">Income</option></select></div>
            <div className="space-y-1.5"><label htmlFor="transaction-currency" className="block text-sm font-semibold text-slate-700">Currency</label><select id="transaction-currency" className="field" value={form.currency} onChange={event => setForm(current => ({ ...current, currency: event.target.value }))}>{Object.keys(currencyExponent).map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></div>
            <TextField label={`Amount (${form.currency})`} type="number" inputMode="decimal" min="0.01" step={form.currency === 'JPY' ? '1' : '0.01'} required value={form.amount} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} placeholder={form.currency === 'JPY' ? '0' : '0.00'} />
            <div className="space-y-1.5"><label htmlFor="transaction-category" className="block text-sm font-semibold text-slate-700">Category</label><input id="transaction-category" list="transaction-category-options" maxLength={40} required value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))} className="field" placeholder="Choose or enter a category" /><datalist id="transaction-category-options">{categories.map(category => <option key={category} value={category} />)}</datalist></div>
            <TextField label={`Date (${user?.timezone || 'UTC'})`} type="date" required value={form.occurredDate} onChange={event => setForm(current => ({ ...current, occurredDate: event.target.value }))} />
            <div className="space-y-1.5"><label htmlFor="transaction-payment" className="block text-sm font-semibold text-slate-700">Payment method</label><select id="transaction-payment" className="field" value={form.paymentMethod} onChange={event => setForm(current => ({ ...current, paymentMethod: event.target.value as PaymentMethod | '' }))}><option value="">Not specified</option>{paymentMethods.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></div>
          </div>
          <TextField label="Notes (optional)" maxLength={500} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} placeholder="Add a short note" />
          <p className="text-xs leading-5 text-slate-500">The selected date is interpreted in {user?.timezone || 'UTC'} and stored as a UTC timestamp. Amounts are stored as integer minor units.</p>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</p>}
          <div className="flex justify-end gap-3 pt-2"><Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add transaction'}</Button></div>
        </form>
      </section>
    </div>}
  </div>;
}
