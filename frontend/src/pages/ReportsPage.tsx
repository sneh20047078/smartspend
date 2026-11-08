import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, Download, FileChartColumn, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { financeApi, formatMoney, type DashboardSummary, type Transaction, type TransactionFilters } from '../lib/finance';

const chartColors = ['#4f46e5', '#0f766e', '#d97706', '#db2777', '#0284c7', '#7c3aed', '#65a30d', '#e11d48'];

function initialRange() {
  const end = new Date().toISOString().slice(0, 10);
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 89);
  return { start: startDate.toISOString().slice(0, 10), end };
}

function csvCell(value: string | number | null): string {
  let normalized = value === null ? '' : String(value);
  if (/^[\uFEFF\s\u0000-\u001f]*[=+@-]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function transactionsCsv(items: Transaction[]): string {
  const headers = ['transaction_id', 'occurred_at_utc', 'kind', 'amount_minor', 'currency', 'category', 'notes', 'payment_method'];
  const rows = items.map(item => [
    item.transaction_id,
    item.occurred_at,
    item.kind,
    item.amount_minor,
    item.currency,
    item.category,
    item.notes,
    item.payment_method,
  ]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

async function fetchAllTransactions(token: string, startDate: string, endDate: string): Promise<Transaction[]> {
  const result: Transaction[] = [];
  let cursor: string | undefined;
  const visited = new Set<string>();
  do {
    const filters: TransactionFilters = { start_date: startDate, end_date: endDate, limit: 100, cursor };
    const page = await financeApi.listTransactions(token, filters);
    result.push(...page.items);
    cursor = page.next_cursor ?? undefined;
    if (cursor && visited.has(cursor)) throw new Error('Transaction export pagination did not advance.');
    if (cursor) visited.add(cursor);
  } while (cursor);
  return result;
}

export function ReportsPage() {
  const { token } = useAuth();
  const initial = useMemo(initialRange, []);
  const [range, setRange] = useState(initial);
  const [appliedRange, setAppliedRange] = useState(initial);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [currency, setCurrency] = useState('all');
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      financeApi.dashboard(token, appliedRange.start, appliedRange.end),
      fetchAllTransactions(token, appliedRange.start, appliedRange.end),
    ])
      .then(([report, items]) => {
        if (!active) return;
        setSummary(report);
        setTransactions(items);
        if (currency !== 'all' && !report.currencies.some(item => item.currency === currency)) setCurrency('all');
      })
      .catch(reason => {
        if (active) setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Report data could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, appliedRange]);

  const availableCurrencies = summary?.currencies ?? [];
  const filteredTotals = availableCurrencies.filter(item => currency === 'all' || item.currency === currency);
  const filteredCategories = (summary?.category_totals ?? []).filter(item => currency === 'all' || item.currency === currency);
  const filteredTrend = (summary?.monthly_trend ?? []).filter(item => currency === 'all' || item.currency === currency);
  const filteredTransactions = transactions.filter(item => currency === 'all' || item.currency === currency);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const start = new Date(`${range.start}T00:00:00Z`);
    const end = new Date(`${range.end}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      setError('Choose a valid date range with the end date on or after the start date.');
      return;
    }
    if ((end.getTime() - start.getTime()) / 86_400_000 > 365) {
      setError('Reports support date ranges of up to 366 days.');
      return;
    }
    setAppliedRange(range);
  }

  async function refreshAndExport() {
    if (!token) return;
    setExportLoading(true);
    setError('');
    setNotice('');
    try {
      // Fetch fresh owner-scoped records at export time to avoid exporting stale page state.
      const fresh = await fetchAllTransactions(token, appliedRange.start, appliedRange.end);
      const filtered = fresh.filter(item => currency === 'all' || item.currency === currency);
      const blob = new Blob([`\uFEFF${transactionsCsv(filtered)}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `smartspend-transactions-${appliedRange.start}-to-${appliedRange.end}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setNotice(`Exported ${filtered.length} of your transactions as CSV.`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'CSV export could not be prepared.');
    } finally {
      setExportLoading(false);
    }
  }

  return <div className="page-shell space-y-7">
    <div className="page-heading flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div><p className="page-eyebrow">Your financial activity</p><h1 className="page-title mt-2 text-ink">Reports</h1><p className="page-description mt-2">Review spending patterns or export your own transaction records.</p></div>
      <form onSubmit={applyRange} className="surface-card flex flex-wrap items-end gap-3 rounded-2xl p-3 shadow-sm">
        <span className="flex h-10 items-center gap-2 px-1 text-xs font-semibold text-slate-600"><CalendarDays size={15} /> Date range · UTC</span>
        <TextField label="From" type="date" required value={range.start} onChange={event => setRange(current => ({ ...current, start: event.target.value }))} />
        <TextField label="To" type="date" required value={range.end} onChange={event => setRange(current => ({ ...current, end: event.target.value }))} />
        <Button type="submit" variant="ghost" className="border border-slate-200">Update report</Button>
      </form>
    </div>

    <div className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-3xl text-sm leading-6 text-indigo-900">Reports include only records owned by your signed-in account. Currency totals are kept separate; no conversion is applied. CSV export includes transaction details for the selected date range.</p>
      <div className="flex shrink-0 items-center gap-2"><label htmlFor="report-currency" className="sr-only">Filter by currency</label><select id="report-currency" className="field min-w-28 bg-white" value={currency} onChange={event => setCurrency(event.target.value)}><option value="all">All currencies</option>{availableCurrencies.map(item => <option key={item.currency} value={item.currency}>{item.currency}</option>)}</select><Button type="button" onClick={() => void refreshAndExport()} disabled={loading || exportLoading}><Download size={16} />{exportLoading ? 'Preparing…' : 'Export CSV'}</Button></div>
    </div>

    {error && <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
    {notice && <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}

    {loading ? <section className="grid gap-4 md:grid-cols-3" aria-label="Loading report"><div className="skeleton-card" /><div className="skeleton-card" /><div className="skeleton-card" /></section> : !summary || transactions.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand"><FileChartColumn size={22} /></span>
      <h2 className="mt-4 font-bold text-ink">No transactions in this date range</h2>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted">Reports are calculated from your saved transactions only. Adjust the dates or add a transaction to get started.</p>
    </section> : <>
      <section className="grid gap-4 md:grid-cols-3" aria-label="Report totals">{filteredTotals.map(total => <article key={total.currency} className="surface-card p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{total.currency}</p><div className="mt-4 grid grid-cols-3 gap-3"><div><p className="text-xs text-muted">Income</p><p className="mt-1 text-sm font-bold text-emerald-700">{formatMoney(total.income_minor, total.currency)}</p></div><div><p className="text-xs text-muted">Expenses</p><p className="mt-1 text-sm font-bold text-rose-700">{formatMoney(total.expense_minor, total.currency)}</p></div><div><p className="text-xs text-muted">Net</p><p className="mt-1 text-sm font-bold text-ink">{formatMoney(total.balance_minor, total.currency)}</p></div></div></article>)}</section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="surface-card p-5 shadow-sm sm:p-6"><div><h2 className="font-bold text-ink">Monthly cash flow</h2><p className="mt-1 text-sm text-muted">Each currency uses its own chart and scale; values are minor units.</p></div>{filteredTrend.length === 0 ? <p className="mt-8 text-center text-sm text-muted">No trend data available.</p> : <div className="mt-5 space-y-6">{filteredTotals.map(total => {
          const currencyTrend = filteredTrend.filter(item => item.currency === total.currency);
          return <div key={total.currency}><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{total.currency}</h3><div className="h-56" role="img" aria-label={`${total.currency} monthly income and expense report`}><ResponsiveContainer width="100%" height="100%"><BarChart data={currencyTrend} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}><CartesianGrid stroke="#e8edf5" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fill: '#748097', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#748097', fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name === 'income_minor' ? 'Income (minor units)' : 'Expenses (minor units)']} /><Bar dataKey="income_minor" name="income_minor" fill="#4f46e5" radius={[5, 5, 0, 0]} /><Bar dataKey="expense_minor" name="expense_minor" fill="#f59e0b" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></div>;
        })}</div>}</article>
        <article className="surface-card p-5 shadow-sm sm:p-6"><div><h2 className="font-bold text-ink">Expenses by category</h2><p className="mt-1 text-sm text-muted">Category spending, separated by currency.</p></div>{filteredCategories.length === 0 ? <p className="mt-8 text-center text-sm text-muted">No expense categories in this period.</p> : <div className="mt-5 space-y-6">{filteredTotals.map(total => {
          const categoryRows = filteredCategories.filter(item => item.currency === total.currency).slice(0, 10);
          if (categoryRows.length === 0) return null;
          const maxAmount = Math.max(...categoryRows.map(row => row.expense_minor));
          return <div key={total.currency}><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{total.currency}</h3><div className="space-y-4">{categoryRows.map((item, index) => <div key={`${item.currency}-${item.category}`}><div className="mb-1.5 flex justify-between gap-3 text-sm"><span className="truncate font-medium capitalize text-slate-700">{item.category}</span><span className="shrink-0 font-semibold text-ink">{formatMoney(item.expense_minor, item.currency)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(3, item.expense_minor / maxAmount * 100)}%`, backgroundColor: chartColors[index % chartColors.length] }} /></div></div>)}</div></div>;
        })}</div>}</article>
      </section>

      <section className="surface-card data-table overflow-hidden rounded-2xl shadow-sm"><div className="flex flex-col gap-1 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-ink">Export preview</h2><p className="mt-1 text-xs text-muted">{filteredTransactions.length} transactions · {appliedRange.start} through {appliedRange.end} UTC</p></div><Button type="button" variant="ghost" className="border border-slate-200" onClick={() => void refreshAndExport()} disabled={exportLoading}><Download size={15} /> Export CSV</Button></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><caption className="sr-only">Transactions included in the CSV export</caption><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th scope="col" className="px-5 py-3">Date (UTC)</th><th scope="col" className="px-5 py-3">Transaction</th><th scope="col" className="px-5 py-3">Type</th><th scope="col" className="px-5 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredTransactions.slice(0, 25).map(item => <tr key={item.transaction_id}><td className="whitespace-nowrap px-5 py-3 text-slate-600">{new Date(item.occurred_at).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })}</td><td className="px-5 py-3"><p className="font-semibold capitalize text-ink">{item.category}</p><p className="max-w-xs truncate text-xs text-muted">{item.notes || 'No notes'}</p></td><td className="px-5 py-3 capitalize text-slate-600">{item.kind}</td><td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-ink">{formatMoney(item.amount_minor, item.currency)}</td></tr>)}</tbody></table></div>{filteredTransactions.length > 25 && <p className="border-t border-slate-100 px-5 py-3 text-xs text-muted">Showing 25 of {filteredTransactions.length}. CSV export includes all matching records.</p>}</section>
    </>}
  </div>;
}
