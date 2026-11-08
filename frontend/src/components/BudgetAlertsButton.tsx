import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { financeApi, type BudgetStatus } from '../lib/finance';

type AlertItem = { id: string; budgetName: string; category: string; percent: number; currency: string };

function activeBudgetAlerts(budgets: BudgetStatus[]): AlertItem[] {
  return budgets.flatMap(budget => budget.categories
    .filter(category => category.threshold_reached)
    .map(category => ({
      id: `${budget.budget_id}:${category.category}`,
      budgetName: budget.name,
      category: category.category,
      percent: category.percent_used,
      currency: budget.currency,
    })));
}

export function BudgetAlertsButton() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !token) return;
    let active = true;
    setLoading(true);
    setError('');
    financeApi.listBudgets(token)
      .then(page => { if (active) setAlerts(activeBudgetAlerts(page.items)); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Budget alerts could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, token]);

  const visibleAlerts = alerts.filter(alert => !dismissed.includes(alert.id));
  return <div className="relative">
    <button className="relative grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100" aria-label={`${visibleAlerts.length ? `${visibleAlerts.length} budget alerts` : 'No budget alerts'}`} aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <Bell size={17} />
      {visibleAlerts.length > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{visibleAlerts.length > 9 ? '9+' : visibleAlerts.length}</span>}
    </button>
    {open && <section aria-label="Budget alerts" className="absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="text-sm font-bold text-ink">Budget alerts</h2><p className="mt-0.5 text-xs text-muted">In-app only · based on current spending</p></div><button aria-label="Close budget alerts" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X size={15} /></button></div>
      {loading ? <p role="status" className="px-4 py-6 text-center text-sm text-muted">Checking your budgets…</p> : error ? <p role="alert" className="px-4 py-5 text-sm text-rose-700">{error}</p> : visibleAlerts.length === 0 ? <div className="px-4 py-7 text-center"><span className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Check size={18} /></span><p className="mt-2 text-sm font-semibold text-ink">You’re all caught up</p><p className="mt-1 text-xs text-muted">No active budget thresholds right now.</p></div> : <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">{visibleAlerts.map(alert => <li key={alert.id} className="flex items-start gap-3 px-4 py-3"><AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={16} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold capitalize text-ink">{alert.category}</p><p className="mt-0.5 text-xs text-muted">{alert.budgetName} · {alert.percent}% used · {alert.currency}</p></div><button aria-label={`Dismiss ${alert.category} alert`} onClick={() => setDismissed(current => [...current, alert.id])} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={14} /></button></li>)}</ul>}
      <div className="border-t border-slate-100 px-4 py-3"><Link to="/budgets" onClick={() => setOpen(false)} className="text-sm font-semibold text-brand hover:text-brand-dark">Review budgets</Link></div>
    </section>}
  </div>;
}
