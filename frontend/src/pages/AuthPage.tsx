import { useState, type FormEvent } from 'react';
import { ArrowRight, BadgeCheck, ChartNoAxesCombined, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

type AuthView = 'login' | 'register' | 'confirm' | 'forgot' | 'reset';

export function AuthPage() {
  const { login, register, confirmRegistration, beginPasswordReset, finishPasswordReset, mode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [view, setView] = useState<AuthView>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isSecure = mode === 'cognito' || mode === 'secure';

  const titles: Record<AuthView, string> = {
    login: 'Welcome back',
    register: 'Create your account',
    confirm: 'Check your inbox',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
  };

  const descriptions: Record<AuthView, string> = {
    login: isSecure
      ? 'Sign in securely to continue to your private financial account.'
      : 'Use any email to open a local development session.',
    register: 'Start tracking expenses, managing budgets, and splitting group bills securely.',
    confirm: `Enter the verification code sent to ${email}.`,
    forgot: 'We’ll send a secure verification code to your email.',
    reset: `Enter the verification code sent to ${email} and choose a new password.`,
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (view === 'login') {
        await login(email, isSecure ? password : undefined);
        const target = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';
        navigate(target, { replace: true });
      } else if (view === 'register') {
        await register(email, password, displayName);
        if (mode === 'cognito') {
          setView('confirm');
          setNotice('Your account was created. Verify your email to finish signing up.');
        } else {
          // Direct login on secure local database
          const target = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';
          navigate(target, { replace: true });
        }
      } else if (view === 'confirm') {
        await confirmRegistration(email, code);
        setView('login');
        setNotice('Email verified. Sign in to continue.');
      } else if (view === 'forgot') {
        await beginPasswordReset(email);
        setView('reset');
        setNotice('If an account exists, a reset code has been sent.');
      } else {
        await finishPasswordReset(email, code, newPassword);
        setView('login');
        setPassword('');
        setNewPassword('');
        setCode('');
        setNotice('Password updated. You can now sign in.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We could not complete that request. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const isCode = view === 'confirm' || view === 'reset';

  return (
    <main className="min-h-screen bg-[#f8fafc] dark:bg-[#090d16] lg:grid lg:grid-cols-[1.08fr_0.92fr]">
      {/* Brand Hero Column */}
      <section className="auth-hero relative hidden overflow-hidden px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-36 top-20 h-96 w-96 rounded-full border border-white/[0.06] bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="pointer-events-none absolute right-[-8rem] top-[34%] h-[30rem] w-[30rem] rounded-full border border-white/[0.055]" />
        <div className="pointer-events-none absolute right-[-4rem] top-[39%] h-[22rem] w-[22rem] rounded-full border border-white/[0.055]" />

        <Link to="/login" className="relative z-10 inline-flex items-center gap-3 text-lg font-bold tracking-tight">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-600 to-violet-500 text-white shadow-md shadow-indigo-500/30">
            <ChartNoAxesCombined size={21} />
          </span>
          <span className="text-xl font-black">SmartSpend</span>
        </Link>

        <div className="relative z-10 max-w-xl pb-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-indigo-200">
            <Sparkles size={14} className="text-indigo-400" />
            <span>High-Precision Financial Platform</span>
          </div>
          <h1 className="text-5xl font-extrabold leading-[1.12] tracking-tight xl:text-6xl">
            Spend with purpose.<br />
            <span className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-transparent">
              Grow with confidence.
            </span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">
            A secure, private personal finance workspace with group bill splitting, automated debt-netting settlements, and real-time budgeting.
          </p>

          <div className="mt-10 flex items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4.5 backdrop-blur-xs">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-400">
              <ShieldCheck size={24} />
            </span>
            <div>
              <p className="text-sm font-bold">Encrypted & Isolated Ledger</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-400">
                PBKDF2-HMAC password hashing and owner-scoped financial records.
              </p>
            </div>
            <BadgeCheck className="ml-auto shrink-0 text-emerald-400" size={22} />
          </div>
        </div>

        <p className="relative z-10 text-xs text-slate-500">
          Precision minor-unit financial calculations · Distributed concurrency safe
        </p>
      </section>

      {/* Auth Form Column */}
      <section className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50/70 px-5 py-10 sm:px-10 dark:from-[#090d16] dark:via-[#0b1120] dark:to-indigo-950/30">
        <div className="auth-panel w-full max-w-md rounded-[1.75rem] px-6 py-7 sm:px-9 sm:py-9">
          {/* Mobile Logo */}
          <Link to="/login" className="mb-8 inline-flex items-center gap-2.5 text-lg font-black text-ink lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-600 to-violet-500 text-white shadow-md shadow-indigo-500/25">
              <ChartNoAxesCombined size={20} />
            </span>
            <span>SmartSpend</span>
          </Link>

          <div className="mb-7">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                isSecure
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40'
                  : 'bg-amber-50 text-amber-700 border border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isSecure ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              {isSecure ? 'SECURE ACCOUNT' : 'LOCAL DEVELOPMENT'}
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink">{titles[view]}</h2>
            <p className="mt-1.5 text-sm leading-6 text-muted">{descriptions[view]}</p>
          </div>

          <form className="space-y-5" onSubmit={submit}>
            {(view === 'login' || view === 'register' || view === 'forgot') && (
              <TextField
                label="Email address"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            )}

            {view === 'register' && (
              <TextField
                label="Your name"
                autoComplete="name"
                required
                minLength={1}
                maxLength={80}
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                placeholder="Alex Rivera"
              />
            )}

            {view === 'login' && isSecure && (
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="Enter your password"
              />
            )}

            {view === 'register' && (
              <TextField
                label="Password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                hint="Choose a secure password with at least 8 characters."
              />
            )}

            {isCode && (
              <TextField
                label="Verification code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={event => setCode(event.target.value)}
                placeholder="Enter the code from your email"
              />
            )}

            {view === 'reset' && (
              <TextField
                label="New password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                placeholder="At least 8 characters"
                hint="Choose a secure password with at least 8 characters."
              />
            )}

            {error && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
              >
                {error}
              </div>
            )}

            {notice && (
              <div
                role="status"
                className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-5 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                {notice}
              </div>
            )}

            <Button className="w-full" type="submit" loading={busy}>
              {view === 'login'
                ? 'Sign in'
                : view === 'register'
                ? 'Create account'
                : view === 'confirm'
                ? 'Verify email'
                : view === 'forgot'
                ? 'Send reset code'
                : 'Update password'}
              {!busy && <ArrowRight size={17} />}
            </Button>
          </form>

          {/* Navigation Links */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
            {view === 'login' && isSecure && mode === 'cognito' && (
              <button
                type="button"
                onClick={() => {
                  setView('forgot');
                  setError('');
                  setNotice('');
                }}
                className="font-semibold text-brand hover:text-brand-dark dark:text-indigo-400"
              >
                Forgot password?
              </button>
            )}

            {view === 'login' && isSecure && (
              <span className="text-muted">
                New here?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setView('register');
                    setError('');
                    setNotice('');
                  }}
                  className="font-semibold text-brand hover:text-brand-dark dark:text-indigo-400"
                >
                  Create account
                </button>
              </span>
            )}

            {view !== 'login' && (
              <button
                type="button"
                onClick={() => {
                  setView('login');
                  setError('');
                  setNotice('');
                }}
                className="font-semibold text-brand hover:text-brand-dark dark:text-indigo-400"
              >
                Back to sign in
              </button>
            )}
          </div>

          {/* Only render warning if explicitly in local mock mode */}
          {mode === 'local' && (
            <p className="mt-8 rounded-2xl bg-amber-50 border border-amber-200/60 px-4 py-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40">
              Local-only mode: no password is used or stored. This development identity is not suitable for real accounts or production.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
