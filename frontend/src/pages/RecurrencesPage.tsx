import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarClock, Pause, Play, Plus, Repeat2, Trash2, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ApiError } from '../lib/api';
import { currencyExponent, decimalToMinorUnits, financeApi, formatMoney, type RecurrenceDraft, type RecurrenceFrequency, type RecurringSchedule } from '../lib/finance';

type FormState = {
  description: string;
  amount: string;
  currency: string;
  category: string;
  notes: string;
  frequency: RecurrenceFrequency;
  interval: string;
  startsOn: string;
  endsOn: string;
};

function localDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankForm(currency: string): FormState {
  return { description: '', amount: '', currency, category: '', notes: '', frequency: 'monthly', interval: '1', startsOn: localDate(), endsOn: '' };
}

function dueLabel(schedule: RecurringSchedule): string {
  if (!schedule.enabled) return 'Paused';
  return `Next expense ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${schedule.next_occurrence_on}T00:00:00Z`))}`;
}

export function RecurrencesPage() {
  const { token, user } = useAuth();
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => blankForm(user?.preferred_currency || 'USD'));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const idempotency = useRef({ signature: '', key: '' });

  const loadSchedules = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      setSchedules(await financeApi.listRecurrences(token));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Recurring expenses could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadSchedules(); }, [loadSchedules, refresh]);

  function openCreate() {
    setForm(blankForm(user?.preferred_currency || 'USD'));
    setFormError('');
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setFormError('');
    try {
      const draft: RecurrenceDraft = {
        description: form.description.trim(),
        amount_minor: decimalToMinorUnits(form.amount, form.currency),
        currency: form.currency,
        category: form.category.trim().toLowerCase(),
        notes: form.notes.trim() || null,
        payment_method: null,
        frequency: form.frequency,
        interval: Number(form.interval),
        starts_on: form.startsOn,
        ends_on: form.endsOn || null,
      };
      const signature = JSON.stringify(draft);
      if (idempotency.current.signature !== signature) idempotency.current = { signature, key: crypto.randomUUID() };
      await financeApi.createRecurrence(token, draft, idempotency.current.key);
      idempotency.current = { signature: '', key: '' };
      setDialogOpen(false);
      setNotice('Recurring expense saved. Due expenses are generated the next time schedules are opened.');
      setRefresh(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Recurring expense could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(schedule: RecurringSchedule) {
    if (!token) return;
    setError('');
    try {
      await financeApi.updateRecurrence(token, schedule.schedule_id, { expected_version: schedule.version, enabled: !schedule.enabled });
      setNotice(schedule.enabled ? 'Recurring expense paused.' : 'Recurring expense resumed.');
      setRefresh(value => value + 1);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Recurring expense could not be updated.');
    }
  }

  async function remove(schedule: RecurringSchedule) {
    if (!token || !window.confirm(`Delete the recurring “${schedule.description}” expense? Generated transactions will remain.`)) return;
    setError('');
    try {
      await financeApi.deleteRecurrence(token, schedule.schedule_id, schedule.version);
      setNotice('Recurring schedule deleted. Existing transactions were kept.');
      setRefresh(value => value + 1);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Recurring schedule could not be deleted.');
    }
  }

  return <div className="page-shell space-y-7">
    <div className="page-heading flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="page-eyebrow">Automated expense entries</p><h1 className="page-title mt-2 text-ink">Recurring expenses</h1><p className="page-description mt-2">Set weekly or monthly expense rules with a fixed amount and category.</p></div>
      <Button onClick={openCreate}><Plus size={17} /> Create schedule</Button>
    </div>

    <div className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-900"><CalendarClock className="mt-0.5 shrink-0" size={17} /><p>Due entries are generated idempotently when you sign in or reopen this page. Generation is request-driven; there is no always-on scheduler in the no-AWS-cost local mode. Review generated transactions before relying on them for financial reporting.</p></div>
    {error && <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
    {notice && <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}

    {loading ? <section className="grid gap-4 lg:grid-cols-2" aria-label="Loading recurring expenses"><div className="skeleton-card min-h-44" /><div className="skeleton-card min-h-44" /></section> : schedules.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand"><Repeat2 size={22} /></span><h2 className="mt-4 font-bold text-ink">No recurring expenses</h2><p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted">Create a rule for regular bills. SmartSpend only generates due entries when you open this page, and every entry is a normal transaction you can review or delete.</p><Button className="mt-5" onClick={openCreate}><Plus size={16} /> Create your first schedule</Button></section> : <section aria-label="Recurring expense schedules" className="grid gap-4 xl:grid-cols-2">{schedules.map(schedule => <article key={schedule.schedule_id} className="surface-card rounded-2xl p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-bold capitalize text-ink">{schedule.description}</h2><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${schedule.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{schedule.enabled ? 'Active' : 'Paused'}</span></div><p className="mt-1 text-sm capitalize text-muted">{schedule.category} · every {schedule.interval} {schedule.frequency === 'weekly' ? (schedule.interval === 1 ? 'week' : 'weeks') : (schedule.interval === 1 ? 'month' : 'months')}</p></div><p className="shrink-0 text-lg font-bold tabular-nums text-ink">{formatMoney(schedule.amount_minor, schedule.currency)}</p></div><p className="mt-4 flex items-center gap-2 text-sm text-slate-600"><CalendarClock size={15} />{dueLabel(schedule)}</p><p className="mt-1 text-xs text-muted">Starts {schedule.starts_on} {schedule.ends_on ? `· Ends ${schedule.ends_on}` : '· No end date'}</p><div className="mt-5 flex justify-end gap-2"><Button variant="ghost" className="border border-slate-200" onClick={() => void toggle(schedule)}>{schedule.enabled ? <Pause size={15} /> : <Play size={15} />}{schedule.enabled ? 'Pause' : 'Resume'}</Button><button aria-label={`Delete ${schedule.description}`} onClick={() => void remove(schedule)} className="rounded-xl p-2.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button></div></article>)}</section>}

    {dialogOpen && <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setDialogOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="recurrence-form-title" className="my-8 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between"><div><h2 id="recurrence-form-title" className="text-xl font-bold text-ink">Create recurring expense</h2><p className="mt-1 text-sm text-muted">Each generated entry is saved as a standard expense transaction.</p></div><button onClick={() => setDialogOpen(false)} aria-label="Close recurring expense form" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div><form onSubmit={submit} className="mt-6 space-y-4"><TextField label="Expense description" required maxLength={120} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="Rent, subscription, insurance" /><div className="grid gap-4 sm:grid-cols-2"><TextField label="Amount" type="number" inputMode="decimal" min="0.01" step={form.currency === 'JPY' ? '1' : '0.01'} required value={form.amount} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} placeholder={form.currency === 'JPY' ? '0' : '0.00'} /><div className="space-y-1.5"><label htmlFor="recurrence-currency" className="block text-sm font-semibold text-slate-700">Currency</label><select id="recurrence-currency" className="field" value={form.currency} onChange={event => setForm(current => ({ ...current, currency: event.target.value }))}>{Object.keys(currencyExponent).map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></div><TextField label="Category" required maxLength={40} value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))} placeholder="e.g. housing" /><div className="space-y-1.5"><label htmlFor="recurrence-frequency" className="block text-sm font-semibold text-slate-700">Frequency</label><select id="recurrence-frequency" className="field" value={form.frequency} onChange={event => setForm(current => ({ ...current, frequency: event.target.value as RecurrenceFrequency }))}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div><TextField label={`Every (${form.frequency === 'weekly' ? 'weeks' : 'months'})`} type="number" min="1" max={form.frequency === 'weekly' ? '52' : '12'} step="1" required value={form.interval} onChange={event => setForm(current => ({ ...current, interval: event.target.value }))} /><TextField label="Starts on (UTC)" type="date" required value={form.startsOn} onChange={event => setForm(current => ({ ...current, startsOn: event.target.value }))} /><TextField label="Ends on (optional)" type="date" value={form.endsOn} onChange={event => setForm(current => ({ ...current, endsOn: event.target.value }))} /></div><TextField label="Notes (optional)" maxLength={500} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} />{formError && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</p>}<div className="flex justify-end gap-3 pt-2"><Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create schedule'}</Button></div></form></section></div>}
  </div>;
}
