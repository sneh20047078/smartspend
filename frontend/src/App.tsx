import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeftRight, Bell, ChartNoAxesCombined, CircleHelp, LayoutDashboard, LogOut, Menu, Settings2, WalletCards, X } from 'lucide-react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { Button } from './components/Button';
import { TextField } from './components/TextField';

const AuthPage = lazy(() => import('./pages/AuthPage').then(module => ({ default: module.AuthPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage').then(module => ({ default: module.TransactionsPage })));
const BudgetsPage = lazy(() => import('./pages/BudgetsPage').then(module => ({ default: module.BudgetsPage })));

function RouteLoading() {
  return <main className="grid min-h-[60vh] place-items-center"><div role="status" className="w-full max-w-md animate-pulse space-y-4 rounded-2xl border border-slate-200 bg-white p-8"><span className="sr-only">Loading page</span><div className="h-5 w-1/2 rounded bg-slate-200" /><div className="h-4 rounded bg-slate-100" /><div className="h-28 rounded-xl bg-slate-100" /></div></main>;
}

function Dashboard() {
  return <DashboardPage />;
}

function SettingsPage() {
  const { user, saveProfile } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [currency, setCurrency] = useState(user?.preferred_currency || 'USD');
  const [timezone, setTimezone] = useState(user?.timezone || 'UTC');
  const [theme, setTheme] = useState(user?.theme || 'system');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setDisplayName(user?.display_name || '');
    setCurrency(user?.preferred_currency || 'USD');
    setTimezone(user?.timezone || 'UTC');
    setTheme(user?.theme || 'system');
  }, [user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      await saveProfile({ display_name: displayName, preferred_currency: currency, timezone, theme });
      setMessage('Your profile settings have been saved.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your settings could not be saved.');
    } finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-3xl space-y-7">
    <div><p className="text-sm font-medium text-muted">Account</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Settings</h1><p className="mt-2 text-sm text-muted">Manage how SmartSpend presents your account.</p></div>
    <form onSubmit={submit} className="space-y-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="border-b border-slate-100 pb-6"><h2 className="font-bold text-ink">Profile details</h2><p className="mt-1 text-sm text-muted">Your email is managed securely by your sign-in provider.</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <TextField label="Display name" autoComplete="name" required minLength={1} maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} />
          <TextField label="Email address" type="email" value={user?.email || ''} readOnly className="field cursor-not-allowed bg-slate-50 text-slate-500" />
        </div>
      </div>
      <div className="border-b border-slate-100 pb-6"><h2 className="font-bold text-ink">Preferences</h2><p className="mt-1 text-sm text-muted">These preferences affect display, not stored amount values.</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5"><label htmlFor="currency" className="block text-sm font-semibold text-slate-700">Preferred currency</label><select id="currency" className="field" value={currency} onChange={event => setCurrency(event.target.value)}>{['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY'].map(value => <option key={value} value={value}>{value}</option>)}</select></div>
          <TextField label="Time zone (IANA)" value={timezone} onChange={event => setTimezone(event.target.value)} required maxLength={64} placeholder="America/New_York" hint="For example, America/Los_Angeles or Europe/Paris." />
          <div className="space-y-1.5"><label htmlFor="theme" className="block text-sm font-semibold text-slate-700">Appearance</label><select id="theme" className="field" value={theme} onChange={event => setTheme(event.target.value as typeof theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
        </div>
      </div>
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
      <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
    </form>
    <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-bold text-ink">Privacy & account</h2><p className="mt-1 text-sm leading-6 text-muted">Your profile can be updated here. Account deletion and financial-data export controls will be introduced alongside the financial record features and retention policy.</p></section>
  </div>;
}

function AppShell() {
  const { user, logout, mode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = (user?.display_name || user?.email || 'S').split(/[\s@]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('');
  useEffect(() => {
    const useDark = user?.theme === 'dark' || (user?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', Boolean(useDark));
  }, [user?.theme]);
  const links = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
    { to: '/budgets', label: 'Budgets', icon: WalletCards },
    { to: '/settings', label: 'Settings', icon: Settings2 },
  ];
  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }
  const sidebar = <>
    <div className="flex h-[76px] items-center gap-3 px-6"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white"><ChartNoAxesCombined size={21} /></span><span className="text-lg font-extrabold tracking-tight text-ink">SmartSpend</span></div>
    <nav aria-label="Main navigation" className="mt-7 space-y-1 px-3">{links.map(item => {
      const active = location.pathname === item.to;
      return <Link key={item.to} to={item.to} onClick={() => setMenuOpen(false)} aria-current={active ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? 'bg-brand-soft text-brand' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}><item.icon size={18} />{item.label}</Link>;
    })}</nav>
    <div className="mt-auto p-4"><div className="rounded-2xl bg-slate-50 p-4"><div className="flex items-center gap-2 text-xs font-bold text-slate-700"><CircleHelp size={15} /> Getting started</div><p className="mt-2 text-xs leading-5 text-slate-500">Record activity, review spending, and set budgets against your saved expenses.</p><span className="mt-3 inline-flex rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Phase 3 of 6</span></div></div>
  </>;
  return <div className="min-h-screen bg-[#f6f8fc] text-ink">
    {menuOpen && <button aria-label="Close navigation menu" className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden" onClick={() => setMenuOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-slate-200/80 bg-white transition-transform lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between lg:hidden"><div className="flex-1">{sidebar}</div><button onClick={() => setMenuOpen(false)} aria-label="Close navigation menu" className="absolute right-3 top-5 rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
      <div className="hidden h-full flex-col lg:flex">{sidebar}</div>
    </aside>
    <div className="lg:pl-[260px]">
      <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-5 backdrop-blur sm:px-8">
        <div className="flex items-center gap-3"><button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation menu"><Menu size={20} /></button><div className="hidden text-sm font-medium text-slate-400 sm:block">Personal finance <span className="mx-1.5">/</span> <span className="text-slate-700">{location.pathname === '/settings' ? 'Settings' : location.pathname === '/transactions' ? 'Transactions' : location.pathname === '/budgets' ? 'Budgets' : 'Overview'}</span></div></div>
        <div className="flex items-center gap-3"><span className={`hidden rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider sm:inline-flex ${mode === 'local' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{mode === 'local' ? 'Local dev' : 'Secure session'}</span><button className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Notifications are not enabled"><Bell size={17} /></button><div className="hidden h-8 w-px bg-slate-200 sm:block" /><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-700">{initials}</span><span className="hidden max-w-36 truncate text-sm font-semibold text-slate-700 sm:block">{user?.display_name}</span></div><button onClick={() => void handleLogout()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Sign out"><LogOut size={17} /></button></div>
      </header>
      <main className="mx-auto max-w-[1440px] p-5 sm:p-8 lg:p-10"><Outlet /></main>
      <footer className="border-t border-slate-200/80 px-5 py-5 text-center text-xs text-slate-400 sm:px-8">SmartSpend · Your personal finance workspace</footer>
    </div>
  </div>;
}

export function App() {
  return <Routes>
    <Route path="/login" element={<Suspense fallback={<RouteLoading />}><AuthPage /></Suspense>} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AppShell />}>
        <Route index element={<Suspense fallback={<RouteLoading />}><Dashboard /></Suspense>} />
        <Route path="transactions" element={<Suspense fallback={<RouteLoading />}><TransactionsPage /></Suspense>} />
        <Route path="budgets" element={<Suspense fallback={<RouteLoading />}><BudgetsPage /></Suspense>} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
