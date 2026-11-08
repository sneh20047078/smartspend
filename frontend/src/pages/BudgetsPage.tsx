import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarDays, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import {
  currencyExponent,
  decimalToMinorUnits,
  financeApi,
  formatMoney,
  minorUnitsToInput,
  type BudgetDraft,
  type BudgetPeriodType,
  type BudgetStatus,
} from '../lib/finance';

type CategoryLimitInput = { category: string; amount: string };
type BudgetFormState = {
  name: string;
  periodType: BudgetPeriodType;
  month: string;
  startDate: string;
  endDate: string;
  currency: string;
  totalLimit: string;
  categoryLimits: CategoryLimitInput[];
  threshold: string;
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthRange(month: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('Choose a valid calendar month.');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('Choose a valid calendar month.');
  const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(endDay).padStart(2, '0')}` };
}

function blankForm(currency: string): BudgetFormState {
  return {
    name: '', periodType: 'monthly', month: currentMonth(), startDate: `${currentMonth()}-01`, endDate: new Date(Date.UTC(Number(currentMonth().slice(0, 4)), Number(currentMonth().slice(5, 7)), 0)).toISOString().slice(0, 10),
    currency, totalLimit: '', categoryLimits: [{ category: '', amount: '' }], threshold: '80',
  };
}

function editForm(budget: BudgetStatus): BudgetFormState {
  return {
    name: budget.name,
    periodType: budget.period_type,
    month: budget.start_date.slice(0, 7),
    startDate: budget.start_date,
    endDate: budget.end_date,
    currency: budget.currency,
    totalLimit: budget.total_limit_minor === null ? '' : minorUnitsToInput(budget.total_limit_minor, budget.currency),
    categoryLimits: Object.entries(budget.category_limits).map(([category, amount]) => ({ category, amount: minorUnitsToInput(amount, budget.currency) })),
    threshold: String(budget.alert_threshold_percent),
  };
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

export function BudgetsPage() {
  const { token, user } = useAuth();
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetStatus | null>(null);
  const [form, setForm] = useState<BudgetFormState>(() => blankForm(user?.preferred_currency || 'USD'));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const idempotency = useRef({ signature: '', key: '' });

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    financeApi.listBudgets(token)
      .then(page => { if (active) setBudgets(page.items); })
      .catch(reason => { if (active) setLoadError(reason instanceof Error ? reason.message : 'Budgets could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, refresh]);

  function openCreate() {
    setEditing(null);
    setForm(blankForm(user?.preferred_currency || 'USD'));
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(budget: BudgetStatus) {
    setEditing(budget);
    setForm(editForm(budget));
    setFormError('');
    setDialogOpen(true);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setFormError('');
    try {
      const categoryLimits: Record<string, number> = {};
      for (const row of form.categoryLimits) {
        const category = row.category.trim().toLocaleLowerCase();
        if (!category && !row.amount.trim()) continue;
        if (!category || !row.amount.trim()) throw new Error('Enter both a category and its limit, or remove the empty row.');
        if (Object.prototype.hasOwnProperty.call(categoryLimits, category)) throw new Error(`The category “${category}” is listed more than once.`);
        categoryLimits[category] = decimalToMinorUnits(row.amount, form.currency);
      }
      const totalLimit = form.totalLimit.trim() ? decimalToMinorUnits(form.totalLimit, form.currency) : null;
      if (totalLimit === null && Object.keys(categoryLimits).length === 0) throw new Error('Add an overall limit or at least one category limit.');
      const period = form.periodType === 'monthly' ? monthRange(form.month) : { start: form.startDate, end: form.endDate };
      const draft: BudgetDraft = {
        name: form.name.trim(), period_type: form.periodType, start_date: period.start, end_date: period.end,
        currency: form.currency, total_limit_minor: totalLimit, category_limits: categoryLimits,
        alert_threshold_percent: Number(form.threshold),
      };
      if (editing) {
        await financeApi.updateBudget(token, editing.budget_id, {
          expected_version: editing.version,
          name: draft.name,
          total_limit_minor: draft.total_limit_minor,
          category_limits: draft.category_limits,
          alert_threshold_percent: draft.alert_threshold_percent,
        });
        setSuccess('Budget updated.');
      } else {
        const signature = JSON.stringify(draft);
        if (idempotency.current.signature !== signature) idempotency.current = { signature, key: crypto.randomUUID() };
        await financeApi.createBudget(token, draft, idempotency.current.key);
        idempotency.current = { signature: '', key: '' };
        setSuccess('Budget created.');
      }
      setDialogOpen(false);
      setEditing(null);
      setRefresh(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Budget could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(budget: BudgetStatus) {
    if (!token || !window.confirm(`Delete the “${budget.name}” budget? This cannot be undone.`)) return;
    setSuccess('');
    setLoadError('');
    try {
      await financeApi.deleteBudget(token, budget.budget_id, budget.version);
      setSuccess('Budget deleted.');
      setRefresh(value => value + 1);
    } catch (reason) {
      setLoadError(reason instanceof ApiError ? reason.message : 'Budget could not be deleted.');
    }
  }

  return <div className="page-shell space-y-7">
    <div className="page-heading flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="page-eyebrow">Plan your spending</p><h1 className="page-title mt-2 text-ink">Budgets</h1><p className="page-description mt-2">Set monthly or custom limits and track recorded expenses by currency.</p></div>
      <Button onClick={openCreate}><Plus size={17} /> Create budget</Button>
    </div>

    <div className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-900"><CalendarDays className="mt-0.5 shrink-0" size={17} /><p>Progress uses your saved expenses in the budget’s currency and UTC date range. Income is excluded; no currency conversion or notifications are applied.</p></div>
    {loadError && <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{loadError}</span><button aria-label="Dismiss error" onClick={() => setLoadError('')}><X size={16} /></button></div>}
    {success && <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>{success}</span><button aria-label="Dismiss notification" onClick={() => setSuccess('')}><X size={16} /></button></div>}

    {loading ? <section className="grid gap-4 lg:grid-cols-2" aria-label="Loading budgets"><div className="skeleton-card min-h-64" /><div className="skeleton-card min-h-64" /></section> : budgets.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand"><ShieldCheck size={22} /></span>
      <h2 className="mt-4 font-bold text-ink">No budgets yet</h2>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted">Create a monthly or custom budget to see progress from your own saved expense transactions. SmartSpend never inserts sample financial data.</p>
      <Button className="mt-5" onClick={openCreate}><Plus size={16} /> Create your first budget</Button>
    </section> : <section aria-label="Your budgets" className="grid gap-5 xl:grid-cols-2">{budgets.map(budget => <article key={budget.budget_id} className="surface-card rounded-2xl p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-bold text-ink">{budget.name}</h2><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{budget.period_type}</span></div><p className="mt-1 text-sm text-muted">{displayDate(budget.start_date)} – {displayDate(budget.end_date)} · {budget.currency}</p></div><div className="flex shrink-0 gap-1"><button aria-label={`Edit ${budget.name}`} onClick={() => openEdit(budget)} className="rounded-lg p-2 text-slate-500 hover:bg-indigo-50 hover:text-brand"><Pencil size={16} /></button><button aria-label={`Delete ${budget.name}`} onClick={() => void remove(budget)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button></div></div>
      <ul className="mt-6 space-y-5">{budget.categories.map(progress => {
        const width = Math.min(100, Math.max(0, progress.percent_used));
        return <li key={progress.category}>
          <div className="mb-2 flex items-end justify-between gap-3"><div><p className="text-sm font-semibold capitalize text-slate-700">{progress.category}</p><p className="mt-0.5 text-xs text-muted">{formatMoney(progress.spent_minor, budget.currency)} spent · {formatMoney(progress.remaining_minor, budget.currency)} remaining</p></div><div className="text-right"><p className="text-sm font-bold tabular-nums text-ink">{formatMoney(progress.limit_minor, budget.currency)}</p><p className={`text-xs font-semibold ${progress.threshold_reached ? 'text-amber-700' : 'text-slate-500'}`}>{progress.percent_used}% used</p></div></div>
          <div role="progressbar" aria-label={`${progress.category} budget usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, progress.percent_used))} className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${progress.percent_used >= 100 ? 'bg-rose-500' : progress.threshold_reached ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${width}%` }} /></div>
          {progress.threshold_reached && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700"><AlertTriangle size={13} /> {progress.percent_used >= 100 ? 'Limit reached or exceeded' : `${budget.alert_threshold_percent}% alert threshold reached`}</p>}
        </li>;
      })}</ul>
    </article>)}</section>}

    {dialogOpen && <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="budget-form-title" className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between"><div><h2 id="budget-form-title" className="text-xl font-bold text-ink">{editing ? 'Edit budget' : 'Create budget'}</h2><p className="mt-1 text-sm text-muted">Limits are stored as integer minor units in the selected currency.</p></div><button onClick={() => setDialogOpen(false)} aria-label="Close budget form" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
        <form onSubmit={submitForm} className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Budget name" required minLength={1} maxLength={80} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Household spending" />
            <div className="space-y-1.5"><label htmlFor="budget-currency" className="block text-sm font-semibold text-slate-700">Currency</label><select id="budget-currency" className="field" disabled={Boolean(editing)} value={form.currency} onChange={event => setForm(current => ({ ...current, currency: event.target.value }))}>{Object.keys(currencyExponent).map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></div>
            {!editing && <div className="space-y-1.5"><label htmlFor="budget-period" className="block text-sm font-semibold text-slate-700">Budget period</label><select id="budget-period" className="field" value={form.periodType} onChange={event => setForm(current => ({ ...current, periodType: event.target.value as BudgetPeriodType }))}><option value="monthly">Calendar month</option><option value="custom">Custom date range</option></select></div>}
            {!editing && form.periodType === 'monthly' && <TextField label="Month (UTC)" type="month" required value={form.month} onChange={event => setForm(current => ({ ...current, month: event.target.value }))} />}
            {!editing && form.periodType === 'custom' && <><TextField label="Start date (UTC)" type="date" required value={form.startDate} onChange={event => setForm(current => ({ ...current, startDate: event.target.value }))} /><TextField label="End date (UTC)" type="date" required value={form.endDate} onChange={event => setForm(current => ({ ...current, endDate: event.target.value }))} /></>}
            <TextField label={`Overall limit (${form.currency}, optional)`} type="number" inputMode="decimal" min="0.01" step={form.currency === 'JPY' ? '1' : '0.01'} value={form.totalLimit} onChange={event => setForm(current => ({ ...current, totalLimit: event.target.value }))} placeholder="Leave blank for category-only limits" />
            <TextField label="Alert threshold (%)" type="number" min="50" max="100" step="1" required value={form.threshold} onChange={event => setForm(current => ({ ...current, threshold: event.target.value }))} hint="Show an in-app warning when spending reaches this share of a limit." />
          </div>
          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4"><legend className="px-1 text-sm font-bold text-ink">Category limits <span className="font-normal text-muted">(optional)</span></legend>
            {form.categoryLimits.map((row, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"><TextField label={`Category ${index + 1}`} maxLength={40} value={row.category} onChange={event => setForm(current => ({ ...current, categoryLimits: current.categoryLimits.map((item, rowIndex) => rowIndex === index ? { ...item, category: event.target.value } : item) }))} placeholder="e.g. groceries" /><TextField label={`Limit (${form.currency})`} type="number" inputMode="decimal" min="0.01" step={form.currency === 'JPY' ? '1' : '0.01'} value={row.amount} onChange={event => setForm(current => ({ ...current, categoryLimits: current.categoryLimits.map((item, rowIndex) => rowIndex === index ? { ...item, amount: event.target.value } : item) }))} placeholder={form.currency === 'JPY' ? '0' : '0.00'} /><button type="button" aria-label={`Remove category ${index + 1}`} disabled={form.categoryLimits.length === 1} onClick={() => setForm(current => ({ ...current, categoryLimits: current.categoryLimits.filter((_, rowIndex) => rowIndex !== index) }))} className="mb-1 rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"><X size={16} /></button></div>)}
            {form.categoryLimits.length < 20 && <Button type="button" variant="ghost" className="border border-slate-200" onClick={() => setForm(current => ({ ...current, categoryLimits: [...current.categoryLimits, { category: '', amount: '' }] }))}><Plus size={15} /> Add category limit</Button>}
          </fieldset>
          {editing && <p className="text-xs leading-5 text-slate-500">The currency and date range cannot be changed after a budget is created. Saving uses version {editing.version}; if another update wins first, refresh and try again.</p>}
          {formError && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</p>}
          <div className="flex justify-end gap-3 pt-1"><Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create budget'}</Button></div>
        </form>
      </section>
    </div>}
  </div>;
}
