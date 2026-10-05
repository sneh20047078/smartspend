import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChartNoAxesCombined, WalletCards } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { financeApi, formatMoney, type DashboardSummary } from '../lib/finance';

function currentUtcRange() {
  const today = new Date().toISOString().slice(0, 10);
  return { start: `${today.slice(0, 7)}-01`, end: today };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

export function DashboardPage() {
  const { token, user } = useAuth();
  const initialRange = useMemo(currentUtcRange, []);
  const [range, setRange] = useState(initialRange);
  const [appliedRange, setAppliedRange] = useState(initialRange);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError('');
    financeApi.dashboard(token, appliedRange.start, appliedRange.end)
      .then(result => { if (active) setSummary(result); })
      .catch(reason => { if (active) setError(reason instanceof ApiError ? reason.message : 'Dashboard data could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, appliedRange]);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedRange(range);
  }

  const totalsByCurrency = summary?.currencies || [];
  const hasData = totalsByCurrency.length > 0;
  return <div className="space-y-8">
    <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div><p className="text-sm font-medium text-muted">Personal finance</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Your dashboard</h1><p className="mt-2 text-sm text-muted">A clear view of the activity recorded in SmartSpend.</p></div>
      <form onSubmit={applyRange} className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <span className="flex h-10 items-center gap-2 px-1 text-xs font-semibold text-slate-600"><CalendarDays size={15} /> Date range · UTC</span>
        <TextField label="From" type="date" required value={range.start} onChange={event => setRange(current => ({ ...current, start: event.target.value }))} />
        <TextField label="To" type="date" required value={range.end} onChange={event => setRange(current => ({ ...current, end: event.target.value }))} />
        <Button type="submit" variant="ghost" className="border border-slate-200">Update</Button>
      </form>
    </div>

    <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm">
      <span className="font-semibold text-indigo-900">{summary ? `${formatDate(summary.range_start)} – ${formatDate(summary.range_end)}` : `${range.start} – ${range.end}`} <span className="font-normal text-indigo-700">· date boundaries in UTC</span></span>
      <span className="hidden text-xs text-indigo-700 sm:inline">Currency is shown separately; no conversion is applied.</span>
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

    {loading ? <section className="grid gap-4 md:grid-cols-3" aria-label="Loading dashboard"><div className="skeleton-card" /><div className="skeleton-card" /><div className="skeleton-card" /></section> : !hasData ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand"><WalletCards size={22} /></span>
      <h2 className="mt-4 font-bold text-ink">No activity in this date range</h2>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted">Dashboard totals and charts are calculated from your saved transactions only. Add an income or expense to see your financial activity here.</p>
      <Link to="/transactions" className="mt-5 inline-flex rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Add a transaction</Link>
    </section> : <>
      <section aria-label="Income, expense, and net flow totals" className="grid gap-4 lg:grid-cols-3">
        {totalsByCurrency.map(totals => <div key={totals.currency} className="space-y-3">
          <p className="pl-1 text-xs font-bold uppercase tracking-wider text-slate-500">{totals.currency} · selected range</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <MetricCard label="Income" amount={totals.income_minor} currency={totals.currency} icon="income" />
            <MetricCard label="Expenses" amount={totals.expense_minor} currency={totals.currency} icon="expense" />
            <MetricCard label="Net flow" amount={totals.balance_minor} currency={totals.currency} icon="balance" />
          </div>
        </div>)}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div><h2 className="font-bold text-ink">Income & expenses over time</h2><p className="mt-1 text-sm text-muted">Monthly totals within the selected date range; each currency has its own scale.</p></div>
          <div className="mt-5 space-y-8">{totalsByCurrency.map(total => {
            const data = summary!.monthly_trend.filter(item => item.currency === total.currency).map(item => ({ month: item.month, income: item.income_minor, expenses: item.expense_minor }));
            return <div key={total.currency}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{total.currency}</h3>
              <div className="h-64 w-full" role="img" aria-label={`${total.currency} income and expenses chart`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="#e8edf5" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: '#748097', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={value => formatMoney(Number(value), total.currency)} tick={{ fill: '#748097', fontSize: 10 }} axisLine={false} tickLine={false} width={82} />
                    <Tooltip formatter={(value, name) => [formatMoney(Number(value), total.currency), name === 'income' ? 'Income' : 'Expenses']} />
                    <Legend formatter={value => value === 'income' ? 'Income' : 'Expenses'} />
                    <Bar dataKey="income" name="income" fill="#4f46e5" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="expenses" name="expenses" fill="#f59e0b" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>;
          })}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div><h2 className="font-bold text-ink">Spending by category</h2><p className="mt-1 text-sm text-muted">Expense totals grouped by currency.</p></div>
          {summary!.category_totals.length === 0 ? <p className="mt-8 text-center text-sm text-muted">No expenses in this date range.</p> : <div className="mt-5 space-y-5">{totalsByCurrency.map(total => {
            const rows = summary!.category_totals.filter(item => item.currency === total.currency);
            if (rows.length === 0) return null;
            const largest = Math.max(...rows.map(row => row.expense_minor));
            return <div key={total.currency}><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{total.currency}</h3><ul className="space-y-3">{rows.slice(0, 6).map(row => <li key={`${row.currency}-${row.category}`}><div className="mb-1 flex justify-between gap-4 text-sm"><span className="truncate capitalize font-medium text-slate-700">{row.category}</span><span className="shrink-0 font-semibold text-ink">{formatMoney(row.expense_minor, row.currency)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(4, row.expense_minor / largest * 100)}%` }} /></div></li>)}</ul></div>;
          })}</div>}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-ink">Recent transactions</h2><p className="mt-1 text-xs text-muted">From the current date range · amounts retain their recorded currency.</p></div><Link to="/transactions" className="text-sm font-semibold text-brand hover:text-brand-dark">View all</Link></div>
        {summary!.recent_transactions.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">No transactions to show yet.</p> : <div className="divide-y divide-slate-100">{summary!.recent_transactions.map(item => <div key={item.transaction_id} className="flex items-center gap-3 px-5 py-3.5"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${item.kind === 'income' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{item.kind === 'income' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold capitalize text-ink">{item.category}</p><p className="mt-0.5 truncate text-xs text-muted">{item.notes || item.kind} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: user?.timezone || 'UTC' }).format(new Date(item.occurred_at))}</p></div><p className={`whitespace-nowrap text-sm font-bold tabular-nums ${item.kind === 'income' ? 'text-emerald-700' : 'text-slate-700'}`}>{item.kind === 'income' ? '+' : '−'}{formatMoney(item.amount_minor, item.currency)}</p></div>)}</div>}
      </section>
    </>}
  </div>;
}

function MetricCard({ label, amount, currency, icon }: { label: string; amount: number; currency: string; icon: 'income' | 'expense' | 'balance' }) {
  const isPositive = icon === 'income' || (icon === 'balance' && amount >= 0);
  const iconElement = icon === 'income' ? <ArrowDownLeft size={17} /> : icon === 'expense' ? <ArrowUpRight size={17} /> : <ChartNoAxesCombined size={17} />;
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted">{label}</p><span className={`grid h-8 w-8 place-items-center rounded-lg ${isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{iconElement}</span></div><p className={`mt-3 text-xl font-bold tracking-tight tabular-nums ${isPositive ? 'text-ink' : 'text-amber-700'}`}>{formatMoney(amount, currency)}</p></article>;
}
