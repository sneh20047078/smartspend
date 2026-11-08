import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  PieChart,
  Plus,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`)
  );
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
    financeApi
      .dashboard(token, appliedRange.start, appliedRange.end)
      .then(result => {
        if (active) setSummary(result);
      })
      .catch(reason => {
        if (active)
          setError(
            reason instanceof ApiError ? reason.message : 'Dashboard data could not be loaded.'
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, appliedRange]);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedRange(range);
  }

  function setQuickRange(type: 'this-month' | 'last-30' | 'ytd') {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    let startStr = `${todayStr.slice(0, 7)}-01`;

    if (type === 'last-30') {
      const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      startStr = past.toISOString().slice(0, 10);
    } else if (type === 'ytd') {
      startStr = `${today.getFullYear()}-01-01`;
    }

    const newRange = { start: startStr, end: todayStr };
    setRange(newRange);
    setAppliedRange(newRange);
  }

  const totalsByCurrency = summary?.currencies || [];
  const hasData = totalsByCurrency.length > 0;

  return (
    <div className="page-shell dashboard-page space-y-8 pb-12">
      {/* Top Welcome & Filter Bar */}
      <div className="dashboard-hero flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="page-eyebrow">
            Portfolio Overview
          </p>
          <h1 className="page-title mt-2 text-ink">
            Your dashboard
          </h1>
          <p className="page-description mt-2">
            Real-time financial performance, category breakdowns, and cash-flow analytics.
          </p>
        </div>

        {/* Date Filter & Presets */}
        <div className="flex flex-col gap-2.5 sm:items-end">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400">Presets:</span>
            <button
              type="button"
              onClick={() => setQuickRange('this-month')}
              className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-2xs transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => setQuickRange('last-30')}
              className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-2xs transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              Last 30 Days
            </button>
            <button
              type="button"
              onClick={() => setQuickRange('ytd')}
              className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-2xs transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              YTD
            </button>
          </div>

          <form
            onSubmit={applyRange}
            className="dashboard-range surface-card gap-3 rounded-2xl p-3 shadow-xs"
          >
            <span className="flex h-10 items-center gap-1.5 px-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <CalendarDays size={16} className="text-indigo-600 dark:text-indigo-400" />
              <span>Range (UTC)</span>
            </span>
            <TextField
              label="From"
              type="date"
              required
              value={range.start}
              onChange={event => setRange(current => ({ ...current, start: event.target.value }))}
            />
            <TextField
              label="To"
              type="date"
              required
              value={range.end}
              onChange={event => setRange(current => ({ ...current, end: event.target.value }))}
            />
            <Button type="submit" variant="ghost" className="border border-slate-200 dark:border-slate-700">
              Update
            </Button>
          </form>
        </div>
      </div>

      {/* Active Boundary Info Badge */}
      <div className="dashboard-period flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm">
        <span className="font-semibold text-indigo-950 dark:text-indigo-200">
          {summary
            ? `${formatDate(summary.range_start)} – ${formatDate(summary.range_end)}`
            : `${range.start} – ${range.end}`}{' '}
          <span className="font-normal text-indigo-700 dark:text-indigo-400">· UTC Boundaries</span>
        </span>
        <span className="text-xs font-medium text-indigo-700 dark:text-indigo-400">
          Independent multi-currency ledger · No foreign exchange conversion applied
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
        >
          {error}
        </p>
      )}

      {loading ? (
        <section className="grid gap-5 md:grid-cols-3" aria-label="Loading dashboard">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </section>
      ) : !hasData ? (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-indigo-50 text-indigo-600 shadow-xs dark:bg-indigo-950/70 dark:text-indigo-400">
            <WalletCards size={28} />
          </span>
          <h2 className="mt-5 text-xl font-bold text-ink">No activity in this date range</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
            Dashboard totals and charts are calculated from your saved transactions only. Add an income or expense to see your financial activity here.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              to="/transactions"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 hover:from-indigo-700 hover:to-indigo-800"
            >
              <Plus size={16} />
              <span>Add a transaction</span>
            </Link>
          </div>
        </section>
      ) : (
        <>
          {/* KPI Metrics */}
          <section aria-label="Income, expense, and net flow totals" className="space-y-6">
            {totalsByCurrency.map(totals => {
              const savingsRatio =
                totals.income_minor > 0
                  ? Math.round((totals.balance_minor / totals.income_minor) * 100)
                  : null;

              return (
                <div key={totals.currency} className="space-y-3">
                  <div className="flex items-center justify-between pl-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {totals.currency} Ledger · Selected Period
                    </p>
                    {savingsRatio !== null && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          savingsRatio >= 0
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                        }`}
                      >
                        {savingsRatio >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {savingsRatio}% Savings Rate
                      </span>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <MetricCard
                      label="Income"
                      amount={totals.income_minor}
                      currency={totals.currency}
                      icon="income"
                    />
                    <MetricCard
                      label="Expenses"
                      amount={totals.expense_minor}
                      currency={totals.currency}
                      icon="expense"
                    />
                    <MetricCard
                      label="Net flow"
                      amount={totals.balance_minor}
                      currency={totals.currency}
                      icon="balance"
                    />
                  </div>
                </div>
              );
            })}
          </section>

          {/* Charts & Spending Breakdown */}
          <section className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            {/* Bar Chart Container */}
            <div className="surface-card rounded-3xl p-6 shadow-xs hover-card">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-ink">Income & expenses over time</h2>
                  <p className="mt-1 text-sm text-muted">
                    Monthly totals within the selected date range; each currency has its own scale.
                  </p>
                </div>
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                  <ChartNoAxesCombined size={18} />
                </div>
              </div>

              <div className="mt-6 space-y-8">
                {totalsByCurrency.map(total => {
                  const data = summary!.monthly_trend
                    .filter(item => item.currency === total.currency)
                    .map(item => ({
                      month: item.month,
                      income: item.income_minor,
                      expenses: item.expense_minor,
                    }));

                  return (
                    <div key={total.currency} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {total.currency} Trend
                        </h3>
                      </div>
                      <div
                        className="h-68 w-full pt-2"
                        role="img"
                        aria-label={`${total.currency} income and expenses chart`}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 12 }}>
                            <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
                            <XAxis
                              dataKey="month"
                              tick={{ fill: '#94a3b8', fontSize: 12 }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tickFormatter={value => formatMoney(Number(value), total.currency)}
                              tick={{ fill: '#94a3b8', fontSize: 11 }}
                              axisLine={false}
                              tickLine={false}
                              width={88}
                            />
                            <Tooltip
                              formatter={(value, name) => [
                                formatMoney(Number(value), total.currency),
                                name === 'income' ? 'Income' : 'Expenses',
                              ]}
                              contentStyle={{
                                borderRadius: '0.75rem',
                                border: '1px solid #e2e8f0',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                              }}
                            />
                            <Legend
                              formatter={value => (value === 'income' ? 'Income' : 'Expenses')}
                              iconType="circle"
                            />
                            <Bar
                              dataKey="income"
                              name="income"
                              fill="#4f46e5"
                              radius={[6, 6, 0, 0]}
                            />
                            <Bar
                              dataKey="expenses"
                              name="expenses"
                              fill="#f59e0b"
                              radius={[6, 6, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Spending by Category Card */}
            <div className="surface-card rounded-3xl p-6 shadow-xs hover-card">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-ink">Spending by category</h2>
                  <p className="mt-1 text-sm text-muted">Expense totals grouped by currency.</p>
                </div>
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
                  <PieChart size={18} />
                </div>
              </div>

              {summary!.category_totals.length === 0 ? (
                <div className="grid h-56 place-items-center text-center">
                  <p className="text-sm text-muted">No expenses recorded in this date range.</p>
                </div>
              ) : (
                <div className="mt-6 space-y-6">
                  {totalsByCurrency.map(total => {
                    const rows = summary!.category_totals.filter(
                      item => item.currency === total.currency
                    );
                    if (rows.length === 0) return null;
                    const largest = Math.max(...rows.map(row => row.expense_minor));

                    return (
                      <div key={total.currency} className="space-y-3.5">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {total.currency}
                        </h3>
                        <ul className="space-y-3.5">
                          {rows.slice(0, 6).map(row => (
                            <li key={`${row.currency}-${row.category}`} className="space-y-1.5">
                              <div className="flex justify-between gap-4 text-sm">
                                <span className="truncate font-semibold capitalize text-slate-800 dark:text-slate-200">
                                  {row.category}
                                </span>
                                <span className="shrink-0 font-bold tabular-nums text-ink">
                                  {formatMoney(row.expense_minor, row.currency)}
                                </span>
                              </div>
                              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-300"
                                  style={{
                                    width: `${Math.max(6, (row.expense_minor / largest) * 100)}%`,
                                  }}
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Recent Transactions List */}
          <section className="surface-card overflow-hidden rounded-3xl shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4.5 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-ink">Recent transactions</h2>
                <p className="mt-0.5 text-xs text-muted">
                  From the current date range · amounts retain their recorded currency.
                </p>
              </div>
              <Link
                to="/transactions"
                className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-dark dark:text-indigo-400"
              >
                <span>View all</span>
                <ChevronRight size={15} />
              </Link>
            </div>

            {summary!.recent_transactions.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted">No transactions to show yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {summary!.recent_transactions.map(item => {
                  const isIncome = item.kind === 'income';
                  return (
                    <div
                      key={item.transaction_id}
                      className="flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <span
                          className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${
                            isIncome
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                          }`}
                        >
                          {isIncome ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold capitalize text-ink">
                            {item.category}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {item.notes || item.kind} ·{' '}
                            {new Intl.DateTimeFormat(undefined, {
                              dateStyle: 'medium',
                              timeZone: user?.timezone || 'UTC',
                            }).format(new Date(item.occurred_at))}
                          </p>
                        </div>
                      </div>

                      <p
                        className={`whitespace-nowrap text-sm font-black tabular-nums ${
                          isIncome
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {isIncome ? '+' : '−'}
                        {formatMoney(item.amount_minor, item.currency)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  amount,
  currency,
  icon,
}: {
  label: string;
  amount: number;
  currency: string;
  icon: 'income' | 'expense' | 'balance';
}) {
  const isPositive = icon === 'income' || (icon === 'balance' && amount >= 0);
  const iconElement =
    icon === 'income' ? (
      <ArrowDownLeft size={18} />
    ) : icon === 'expense' ? (
      <ArrowUpRight size={18} />
    ) : (
      <ChartNoAxesCombined size={18} />
    );

  return (
    <article className="surface-card metric-card rounded-3xl p-5 shadow-xs hover-card">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-muted">{label}</p>
        <span
          className={`grid h-9 w-9 place-items-center rounded-2xl ${
            isPositive
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
          }`}
        >
          {iconElement}
        </span>
      </div>
      <p
        className={`mt-3 text-2xl font-black tracking-tight tabular-nums ${
          isPositive ? 'text-ink' : 'text-amber-700 dark:text-amber-400'
        }`}
      >
        {formatMoney(amount, currency)}
      </p>
    </article>
  );
}
