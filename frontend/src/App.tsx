import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  FileChartColumn,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Repeat2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { Button } from './components/Button';
import { BudgetAlertsButton } from './components/BudgetAlertsButton';
import { TextField } from './components/TextField';
import { financeApi } from './lib/finance';

const AuthPage = lazy(() => import('./pages/AuthPage').then(module => ({ default: module.AuthPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage').then(module => ({ default: module.TransactionsPage })));
const BudgetsPage = lazy(() => import('./pages/BudgetsPage').then(module => ({ default: module.BudgetsPage })));
const GroupsPage = lazy(() => import('./pages/GroupsPage').then(module => ({ default: module.GroupsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(module => ({ default: module.ReportsPage })));
const RecurrencesPage = lazy(() => import('./pages/RecurrencesPage').then(module => ({ default: module.RecurrencesPage })));

function RouteLoading() {
  return (
    <main className="grid min-h-[60vh] place-items-center">
      <div role="status" className="w-full max-w-md animate-pulse space-y-4 rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="sr-only">Loading page</span>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-indigo-100 dark:bg-indigo-950" />
          <div className="h-5 w-1/3 rounded-md bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="h-4 rounded-md bg-slate-100 dark:bg-slate-800" />
        <div className="h-32 rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
      </div>
    </main>
  );
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
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await saveProfile({ display_name: displayName, preferred_currency: currency, timezone, theme });
      setMessage('Your profile settings have been saved.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-shell mx-auto max-w-3xl space-y-8 pb-12">
      <div className="page-heading">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400">
          <Settings2 size={13} />
          <span>Account Preferences</span>
        </div>
        <h1 className="page-title mt-2 text-ink">Settings</h1>
        <p className="page-description mt-2">Manage your profile, preferred currency, timezone, and display preferences.</p>
      </div>

      <form onSubmit={submit} className="surface-card space-y-8 rounded-3xl p-6 shadow-sm sm:p-8">
        <div className="border-b border-slate-100 pb-7 dark:border-slate-800">
          <h2 className="text-base font-bold text-ink">Profile details</h2>
          <p className="mt-1 text-sm text-muted">Your email is managed securely by your authentication provider.</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <TextField
              label="Display name"
              autoComplete="name"
              required
              minLength={1}
              maxLength={80}
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
            />
            <TextField
              label="Email address"
              type="email"
              value={user?.email || ''}
              readOnly
              className="field cursor-not-allowed bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400"
            />
          </div>
        </div>

        <div className="border-b border-slate-100 pb-7 dark:border-slate-800">
          <h2 className="text-base font-bold text-ink">Regional & appearance</h2>
          <p className="mt-1 text-sm text-muted">These preferences adjust display formatting without mutating raw integer minor units.</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="currency" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Preferred currency
              </label>
              <select
                id="currency"
                className="field"
                value={currency}
                onChange={event => setCurrency(event.target.value)}
              >
                {['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY'].map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              label="Time zone (IANA)"
              value={timezone}
              onChange={event => setTimezone(event.target.value)}
              required
              maxLength={64}
              placeholder="America/New_York"
              hint="For example, America/Los_Angeles or Europe/London."
            />
            <div className="space-y-1.5">
              <label htmlFor="theme" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Appearance
              </label>
              <select
                id="theme"
                className="field"
                value={theme}
                onChange={event => setTheme(event.target.value as typeof theme)}
              >
                <option value="system">System Default</option>
                <option value="light">Light Mode</option>
                <option value="dark">Dark Mode</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-400">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
            {message}
          </p>
        )}

        <div className="flex justify-end pt-2">
          <Button type="submit" loading={busy}>
            Save changes
          </Button>
        </div>
      </form>

      <section className="surface-card rounded-3xl p-6 shadow-sm sm:p-7">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-emerald-600 dark:text-emerald-400" size={18} />
          <h2 className="text-base font-bold text-ink">Privacy & Data Isolation</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted">
          Your financial transactions and budgets are strictly owner-scoped at the database layer. No cross-tenant access is permitted. You can export all your records in CSV format from Reports at any time.
        </p>
        <Link
          to="/reports"
          className="mt-4 inline-flex items-center text-sm font-semibold text-brand hover:text-brand-dark dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Open reports and CSV export <span aria-hidden="true" className="ml-1.5">→</span>
        </Link>
      </section>
    </div>
  );
}

function AppShell() {
  const { user, logout, mode, token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const initials = (user?.display_name || user?.email || 'S')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('');

  useEffect(() => {
    const useDark =
      user?.theme === 'dark' ||
      (user?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', Boolean(useDark));
  }, [user?.theme]);

  useEffect(() => {
    if (token) void financeApi.processDueRecurrences(token).catch(() => undefined);
  }, [token]);

  const links = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
    { to: '/budgets', label: 'Budgets', icon: WalletCards },
    { to: '/recurrences', label: 'Recurring', icon: Repeat2 },
    { to: '/groups', label: 'Groups', icon: Users },
    { to: '/reports', label: 'Reports', icon: FileChartColumn },
    { to: '/settings', label: 'Settings', icon: Settings2 },
  ];

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const sidebar = (
    <div className="flex h-full flex-col justify-between">
      <div>
        {/* Brand Header */}
        <div className="flex h-[76px] items-center gap-3 px-6 border-b border-slate-100/80 dark:border-slate-800/80">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-600 to-violet-500 text-white shadow-md shadow-indigo-500/25">
            <ChartNoAxesCombined size={20} />
          </span>
          <div className="flex flex-col">
            <span className="text-lg font-black tracking-tight text-ink">SmartSpend</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Serverless Edition
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav aria-label="Main navigation" className="mt-6 space-y-1 px-3.5">
          {links.map(item => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`group flex items-center gap-3.5 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-150 ${
                  active
                    ? 'bg-indigo-50/90 text-indigo-700 shadow-xs ring-1 ring-indigo-200/60 dark:bg-indigo-950/70 dark:text-indigo-300 dark:ring-indigo-800/60'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
                }`}
              >
                <item.icon
                  size={19}
                  className={`transition-colors ${
                    active
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Sidebar Footer Card */}
      <div className="p-4">
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span>System Health</span>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Minor-unit precision, DynamoDB transaction locks & SHA-256 idempotency active.
          </p>
          <div className="mt-3 flex items-center justify-between">
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-2xs dark:bg-slate-700 dark:text-slate-300">
              AWS Ready
            </span>
            <Link
              to="/settings"
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
            >
              Preferences →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-canvas min-h-screen text-ink dark:bg-[#090d16]">
      {/* Mobile Backdrop */}
      {menuOpen && (
        <button
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-xs lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`workspace-sidebar fixed inset-y-0 left-0 z-50 flex w-[268px] flex-col border-r border-slate-200/80 bg-white shadow-sm transition-transform duration-200 ease-out lg:translate-x-0 dark:border-slate-800/90 dark:bg-slate-900 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between lg:hidden px-4 pt-3">
            <button
              onClick={() => setMenuOpen(false)}
              aria-label="Close navigation menu"
              className="ml-auto rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <X size={20} />
            </button>
          </div>
          {sidebar}
        </div>
      </aside>

      {/* Main Container */}
      <div className="lg:pl-[268px]">
        {/* Sticky Header */}
        <header className="workspace-header sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-slate-200/80 glass-header px-5 sm:px-8 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button
              className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>
            <div className="hidden text-sm font-medium text-slate-400 sm:block dark:text-slate-500">
              <span>Personal finance</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {location.pathname === '/settings'
                  ? 'Settings'
                  : location.pathname === '/transactions'
                  ? 'Transactions'
                  : location.pathname === '/budgets'
                  ? 'Budgets'
                  : location.pathname === '/groups'
                  ? 'Groups'
                  : location.pathname === '/reports'
                  ? 'Reports'
                  : location.pathname === '/recurrences'
                  ? 'Recurring'
                  : 'Overview'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Quick Add Button */}
            <Link
              to="/transactions"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-950/80 dark:text-indigo-300 dark:hover:bg-indigo-900/80"
            >
              <Plus size={14} />
              <span>New Entry</span>
            </Link>

            {/* Mode badge */}
            <span
              className={`hidden rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider sm:inline-flex items-center gap-1.5 ${
                mode === 'local'
                  ? 'bg-amber-50 text-amber-700 border border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  mode === 'local' ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'
                }`}
              />
              {mode === 'local' ? 'Local dev' : mode === 'cognito' ? 'Cognito Auth' : 'Secure Account'}
            </span>

            {/* Notifications */}
            <BudgetAlertsButton />

            <div className="hidden h-6 w-px bg-slate-200 sm:block dark:bg-slate-800" />

            {/* User Profile */}
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-xs font-black text-white shadow-xs">
                {initials}
              </span>
              <span className="hidden max-w-36 truncate text-sm font-semibold text-slate-800 sm:block dark:text-slate-200">
                {user?.display_name || user?.email}
              </span>
            </div>

            {/* Sign out */}
            <button
              onClick={() => void handleLogout()}
              className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="app-main mx-auto max-w-[1440px] p-5 sm:p-8 lg:p-10">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-200/80 px-5 py-6 text-center text-xs text-slate-400 sm:px-8 dark:border-slate-800/80 dark:text-slate-500">
          SmartSpend · High-Precision Personal Finance & Serverless Budgeting Workspace
        </footer>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<RouteLoading />}>
            <AuthPage />
          </Suspense>
        }
      />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route
            index
            element={
              <Suspense fallback={<RouteLoading />}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="transactions"
            element={
              <Suspense fallback={<RouteLoading />}>
                <TransactionsPage />
              </Suspense>
            }
          />
          <Route
            path="budgets"
            element={
              <Suspense fallback={<RouteLoading />}>
                <BudgetsPage />
              </Suspense>
            }
          />
          <Route
            path="groups"
            element={
              <Suspense fallback={<RouteLoading />}>
                <GroupsPage />
              </Suspense>
            }
          />
          <Route
            path="reports"
            element={
              <Suspense fallback={<RouteLoading />}>
                <ReportsPage />
              </Suspense>
            }
          />
          <Route
            path="recurrences"
            element={
              <Suspense fallback={<RouteLoading />}>
                <RecurrencesPage />
              </Suspense>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
