import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRightLeft, Plus, Trash2, Users, X } from 'lucide-react';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import {
  currencyExponent,
  decimalToMinorUnits,
  financeApi,
  formatMoney,
  type GroupExpenseDraft,
  type GroupRecord,
  type GroupSettlementSummary,
} from '../lib/finance';

type GroupFormState = {
  name: string;
  description: string;
  currency: string;
  members: string;
};

type ExpenseFormState = {
  description: string;
  amount: string;
  paidBy: string;
  splitType: 'equal' | 'custom';
  customSplits: Record<string, string>;
};

function parseMembers(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]+/).map(value => value.trim()).filter(Boolean).map(value => value.toLowerCase()))];
}

function blankGroupForm(currency: string): GroupFormState {
  return { name: '', description: '', currency, members: '' };
}

function blankExpenseForm(group: GroupRecord): ExpenseFormState {
  return {
    description: '',
    amount: '',
    paidBy: group.members[0] ?? '',
    splitType: 'equal',
    customSplits: Object.fromEntries(group.members.map(member => [member, ''])),
  };
}

export function GroupsPage() {
  const { token, user } = useAuth();
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [summary, setSummary] = useState<GroupSettlementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [success, setSuccess] = useState('');
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [groupForm, setGroupForm] = useState<GroupFormState>(() => blankGroupForm(user?.preferred_currency || 'USD'));
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [groupError, setGroupError] = useState('');
  const [expenseError, setExpenseError] = useState('');

  const selectedGroup = useMemo(() => groups.find(group => group.group_id === selectedGroupId) ?? null, [groups, selectedGroupId]);

  useEffect(() => {
    setGroupForm(previous => ({ ...previous, currency: user?.preferred_currency || previous.currency || 'USD' }));
  }, [user?.preferred_currency]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    financeApi.listGroups(token)
      .then(items => {
        if (!active) return;
        setGroups(items);
        if (items.length === 0) {
          setSelectedGroupId(null);
          return;
        }
        if (!selectedGroupId || !items.some(group => group.group_id === selectedGroupId)) {
          setSelectedGroupId(items[0].group_id);
        }
      })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Groups could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, selectedGroupId]);

  useEffect(() => {
    if (!token || !selectedGroupId) {
      setSummary(null);
      return;
    }
    let active = true;
    financeApi.settlementSummary(token, selectedGroupId)
      .then(data => { if (active) setSummary(data); })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [token, selectedGroupId]);

  function openCreateGroup() {
    setGroupError('');
    setGroupForm(blankGroupForm(user?.preferred_currency || 'USD'));
    setGroupDialogOpen(true);
  }

  function openExpenseDialog() {
    if (!selectedGroup) return;
    setExpenseError('');
    setExpenseForm(blankExpenseForm(selectedGroup));
    setExpenseDialogOpen(true);
  }

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSavingGroup(true);
    setGroupError('');
    try {
      const members = parseMembers(groupForm.members);
      if (members.length < 2) throw new Error('Add at least two unique member names or emails.');
      const draft = {
        name: groupForm.name.trim(),
        description: groupForm.description.trim() || null,
        currency: groupForm.currency,
        members,
      };
      const created = await financeApi.createGroup(token, draft, crypto.randomUUID());
      setGroups(current => [created, ...current]);
      setSelectedGroupId(created.group_id);
      setGroupDialogOpen(false);
      setSuccess('Group created.');
    } catch (error) {
      setGroupError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Group could not be created.');
    } finally {
      setSavingGroup(false);
    }
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedGroup || !expenseForm) return;
    setSavingExpense(true);
    setExpenseError('');
    try {
      const amountMinor = decimalToMinorUnits(expenseForm.amount, selectedGroup.currency);
      const paidBy = expenseForm.paidBy.trim().toLowerCase();
      if (!selectedGroup.members.some(member => member.toLowerCase() === paidBy)) throw new Error('The payer must be a member of the group.');

      const draft: GroupExpenseDraft = {
        description: expenseForm.description.trim(),
        amount_minor: amountMinor,
        currency: selectedGroup.currency,
        paid_by: paidBy,
        split_type: expenseForm.splitType,
        splits: null,
        occurred_at: new Date().toISOString(),
      };

      if (draft.split_type === 'custom') {
        const customSplits: Record<string, number> = {};
        let total = 0;
        for (const member of selectedGroup.members) {
          const value = expenseForm.customSplits[member]?.trim();
          if (!value) throw new Error('Every member must have a custom split amount.');
          const share = decimalToMinorUnits(value, selectedGroup.currency);
          customSplits[member] = share;
          total += share;
        }
        if (total !== draft.amount_minor) throw new Error('Custom split values must add up to the total amount.');
        draft.splits = customSplits;
      }

      await financeApi.createGroupExpense(token, selectedGroup.group_id, draft, crypto.randomUUID());
      setExpenseDialogOpen(false);
      setExpenseForm(null);
      setSuccess('Expense added.');
      const refreshed = await financeApi.settlementSummary(token, selectedGroup.group_id);
      setSummary(refreshed);
    } catch (error) {
      setExpenseError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Expense could not be saved.');
    } finally {
      setSavingExpense(false);
    }
  }

  async function removeGroup(group: GroupRecord) {
    if (!token || !window.confirm(`Delete the “${group.name}” group? This cannot be undone.`)) return;
    try {
      await financeApi.deleteGroup(token, group.group_id, group.version);
      setGroups(current => current.filter(item => item.group_id !== group.group_id));
      if (selectedGroupId === group.group_id) {
        setSelectedGroupId(null);
      }
      setSuccess('Group deleted.');
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Group could not be deleted.');
    }
  }

  return <div className="page-shell space-y-7">
    <div className="page-heading flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="page-eyebrow">Shared spending</p>
        <h1 className="page-title mt-2 text-ink">Groups</h1>
        <p className="page-description mt-2">Track who paid, how expenses are split, and who owes whom.</p>
      </div>
      <Button onClick={openCreateGroup}><Plus size={17} /> Create group</Button>
    </div>

    {loadError && <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{loadError}</span><button aria-label="Dismiss error" onClick={() => setLoadError('')}><X size={16} /></button></div>}
    {success && <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>{success}</span><button aria-label="Dismiss notification" onClick={() => setSuccess('')}><X size={16} /></button></div>}

    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="surface-card rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between pb-3">
          <h2 className="font-bold text-ink">Your groups</h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{groups.length}</span>
        </div>
        {loading ? <div className="space-y-3 pt-3" aria-label="Loading groups">{[1, 2, 3].map(item => <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div> : groups.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-100 text-brand"><Users size={20} /></span>
          <h3 className="mt-4 font-bold text-ink">No groups yet</h3>
          <p className="mt-1 text-sm text-muted">Create a group to split shared costs among friends, family, or roommates.</p>
        </div> : <div className="mt-3 space-y-2">{groups.map(group => {
          const active = group.group_id === selectedGroupId;
          return <div key={group.group_id} className={`rounded-xl border p-3 transition ${active ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => setSelectedGroupId(group.group_id)} className="flex-1 text-left">
                <p className="font-semibold text-ink">{group.name}</p>
                <p className="mt-1 text-xs text-muted">{group.members.length} members · {group.currency}</p>
              </button>
              <button type="button" aria-label={`Delete ${group.name}`} onClick={() => void removeGroup(group)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>
            </div>
          </div>;
        })}</div>}
      </aside>

      <section className="surface-card rounded-2xl p-5 shadow-sm sm:p-6">
        {!selectedGroup ? <div className="grid min-h-80 place-items-center text-center text-muted"><div><Users className="mx-auto" size={24} /><p className="mt-3 font-semibold text-ink">Choose a group</p><p className="mt-1 text-sm">Select an existing group or create a new one to view balances and expenses.</p></div></div> : <div className="space-y-6">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-medium text-muted">Group overview</p>
              <h2 className="mt-1 text-2xl font-bold text-ink">{selectedGroup.name}</h2>
              {selectedGroup.description && <p className="mt-2 text-sm leading-6 text-slate-600">{selectedGroup.description}</p>}
            </div>
            <Button onClick={openExpenseDialog}><Plus size={16} /> Add expense</Button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Members</p><p className="mt-2 text-lg font-bold text-ink">{selectedGroup.members.length}</p><p className="mt-1 text-xs text-muted">{selectedGroup.members.join(', ')}</p></div>
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Currency</p><p className="mt-2 text-lg font-bold text-ink">{selectedGroup.currency}</p><p className="mt-1 text-xs text-muted">Shared ledger currency</p></div>
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Expenses</p><p className="mt-2 text-lg font-bold text-ink">{summary?.expenses.length ?? 0}</p><p className="mt-1 text-xs text-muted">Recorded in this group</p></div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
            <div className="rounded-2xl border border-slate-200 p-4">
              <h3 className="font-bold text-ink">Balances</h3>
              <div className="mt-4 space-y-3">{!summary ? <p className="text-sm text-muted">No settlement data yet.</p> : summary.balances.map(balance => {
                const isPositive = balance.net_minor > 0;
                const magnitude = Math.abs(balance.net_minor);
                return <div key={balance.member_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                  <span className="font-medium text-slate-700">{balance.member_id}</span>
                  <span className={`font-semibold ${isPositive ? 'text-emerald-700' : balance.net_minor < 0 ? 'text-rose-700' : 'text-slate-600'}`}>
                    {balance.net_minor > 0 ? `+${formatMoney(balance.net_minor, selectedGroup.currency)}` : balance.net_minor < 0 ? `-${formatMoney(magnitude, selectedGroup.currency)}` : formatMoney(0, selectedGroup.currency)}
                  </span>
                </div>;
              })}</div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <h3 className="font-bold text-ink">Settlements</h3>
              <div className="mt-4 space-y-3">{!summary || summary.settlements.length === 0 ? <p className="text-sm text-muted">Everything is settled up.</p> : summary.settlements.map((settlement, index) => <div key={`${settlement.from_member}-${settlement.to_member}-${index}`} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm text-slate-700"><span className="font-semibold">{settlement.from_member}</span><ArrowRightLeft size={14} className="text-slate-400" /><span className="font-semibold">{settlement.to_member}</span></div>
                <span className="font-semibold text-ink">{formatMoney(settlement.amount_minor, selectedGroup.currency)}</span>
              </div>)}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="font-bold text-ink">Expense history</h3>
            <div className="mt-4 space-y-3">{!summary || summary.expenses.length === 0 ? <p className="text-sm text-muted">No expenses have been recorded yet.</p> : summary.expenses.map(expense => <div key={expense.expense_id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-ink">{expense.description}</p>
                  <p className="mt-1 text-xs text-muted">Paid by {expense.paid_by} · {new Date(expense.occurred_at).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })}</p>
                </div>
                <span className="font-bold text-ink">{formatMoney(expense.amount_minor, expense.currency)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                {Object.entries(expense.splits).map(([member, amount]) => <span key={`${expense.expense_id}-${member}`} className="rounded-full bg-slate-100 px-2.5 py-1">{member}: {formatMoney(amount, expense.currency)}</span>)}
              </div>
            </div>)}</div>
          </div>
        </div>}
      </section>
    </div>

    {groupDialogOpen && <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setGroupDialogOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="group-form-title" className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between"><div><h2 id="group-form-title" className="text-xl font-bold text-ink">Create group</h2><p className="mt-1 text-sm text-muted">Add a shared wallet for group spending.</p></div><button onClick={() => setGroupDialogOpen(false)} aria-label="Close group form" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
        <form onSubmit={submitGroup} className="mt-6 space-y-4">
          <TextField label="Group name" required maxLength={80} value={groupForm.name} onChange={event => setGroupForm(current => ({ ...current, name: event.target.value }))} />
          <TextField label="Description (optional)" maxLength={500} value={groupForm.description} onChange={event => setGroupForm(current => ({ ...current, description: event.target.value }))} placeholder="Trips, house costs, shared subscriptions" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><label htmlFor="group-currency" className="block text-sm font-semibold text-slate-700">Currency</label><select id="group-currency" className="field" value={groupForm.currency} onChange={event => setGroupForm(current => ({ ...current, currency: event.target.value }))}>{Object.keys(currencyExponent).map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></div>
            <div className="space-y-1.5"><label htmlFor="group-members" className="block text-sm font-semibold text-slate-700">Members</label><input id="group-members" className="field" value={groupForm.members} onChange={event => setGroupForm(current => ({ ...current, members: event.target.value }))} placeholder="alice@example.com, bob@example.com" /></div>
          </div>
          <p className="text-xs leading-5 text-slate-500">The current account owner is added automatically, and duplicate names are ignored. Use comma or newline-separated member labels.</p>
          {groupError && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{groupError}</p>}
          <div className="flex justify-end gap-3 pt-2"><Button type="button" variant="ghost" onClick={() => setGroupDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={savingGroup}>{savingGroup ? 'Creating…' : 'Create group'}</Button></div>
        </form>
      </section>
    </div>}

    {expenseDialogOpen && selectedGroup && <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setExpenseDialogOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="expense-form-title" className="my-8 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between"><div><h2 id="expense-form-title" className="text-xl font-bold text-ink">Add expense</h2><p className="mt-1 text-sm text-muted">Record a shared purchase and how the group split it.</p></div><button onClick={() => setExpenseDialogOpen(false)} aria-label="Close expense form" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
        <form onSubmit={submitExpense} className="mt-6 space-y-5">
          <TextField label="Description" required maxLength={120} value={expenseForm?.description || ''} onChange={event => setExpenseForm(current => current ? { ...current, description: event.target.value } : current)} placeholder="Groceries, rent, train tickets" />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={`Amount (${selectedGroup.currency})`} type="number" inputMode="decimal" min="0.01" step={selectedGroup.currency === 'JPY' ? '1' : '0.01'} required value={expenseForm?.amount || ''} onChange={event => setExpenseForm(current => current ? { ...current, amount: event.target.value } : current)} placeholder={selectedGroup.currency === 'JPY' ? '0' : '0.00'} />
            <div className="space-y-1.5"><label htmlFor="expense-payer" className="block text-sm font-semibold text-slate-700">Paid by</label><select id="expense-payer" className="field" value={expenseForm?.paidBy || selectedGroup.members[0] || ''} onChange={event => setExpenseForm(current => current ? { ...current, paidBy: event.target.value } : current)}>{selectedGroup.members.map(member => <option key={member} value={member}>{member}</option>)}</select></div>
          </div>
          <div className="space-y-1.5"><label htmlFor="expense-split-type" className="block text-sm font-semibold text-slate-700">Split type</label><select id="expense-split-type" className="field" value={expenseForm?.splitType || 'equal'} onChange={event => setExpenseForm(current => current ? { ...current, splitType: event.target.value as 'equal' | 'custom' } : current)}><option value="equal">Equal split</option><option value="custom">Custom split</option></select></div>

          {expenseForm?.splitType === 'custom' && <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4"><legend className="px-1 text-sm font-bold text-ink">Custom shares</legend>{selectedGroup.members.map(member => <div key={member} className="grid grid-cols-[1fr_1fr] items-end gap-2">
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">{member}</div>
            <TextField label="Amount" type="number" inputMode="decimal" min="0.01" step={selectedGroup.currency === 'JPY' ? '1' : '0.01'} value={expenseForm.customSplits[member] || ''} onChange={event => setExpenseForm(current => current ? { ...current, customSplits: { ...current.customSplits, [member]: event.target.value } } : current)} placeholder={selectedGroup.currency === 'JPY' ? '0' : '0.00'} />
          </div>)}</fieldset>}

          {expenseError && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{expenseError}</p>}
          <div className="flex justify-end gap-3 pt-2"><Button type="button" variant="ghost" onClick={() => setExpenseDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={savingExpense}>{savingExpense ? 'Saving…' : 'Add expense'}</Button></div>
        </form>
      </section>
    </div>}
  </div>;
}
