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

  const titles: Record<AuthView, string> = {
    login: 'Welcome back', register: 'Create your account', confirm: 'Check your inbox',
    forgot: 'Reset your password', reset: 'Choose a new password',
  };
  const descriptions: Record<AuthView, string> = {
    login: mode === 'local' ? 'Use any email to open a local development session.' : 'Sign in securely to continue to your account.',
    register: 'Start building healthier money habits with a private account.',
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
        await login(email, password || undefined);
        const target = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';
        navigate(target, { replace: true });
      } else if (view === 'register') {
        await register(email, password, displayName);
        setView('confirm');
        setNotice('Your account was created. Verify your email to finish signing up.');
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
  return <main className="min-h-screen bg-[#f5f7fc] lg:grid lg:grid-cols-[1.08fr_0.92fr]">
    <section className="relative hidden overflow-hidden bg-[#11182c] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
      <div className="absolute -right-36 top-20 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl" />
      <Link to="/login" className="relative z-10 inline-flex items-center gap-3 text-lg font-bold tracking-tight">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500"><ChartNoAxesCombined size={21} /></span>
        SmartSpend
      </Link>
      <div className="relative z-10 max-w-xl pb-10">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-indigo-200"><Sparkles size={14} /> Your money, made clearer</div>
        <h1 className="text-5xl font-semibold leading-[1.12] tracking-tight xl:text-6xl">Spend with purpose.<br /><span className="text-indigo-300">Grow with confidence.</span></h1>
        <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">A calmer way to understand your everyday finances and keep shared expenses fair.</p>
        <div className="mt-10 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-300/10 text-emerald-300"><ShieldCheck size={22} /></span>
          <div><p className="text-sm font-semibold">Privacy comes first</p><p className="mt-1 text-xs leading-5 text-slate-400">Your identity is verified by Cognito in production.</p></div>
          <BadgeCheck className="ml-auto shrink-0 text-emerald-300" size={20} />
        </div>
      </div>
      <p className="relative z-10 text-xs text-slate-500">Simple tools for more intentional money decisions.</p>
    </section>

    <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
      <div className="w-full max-w-md">
        <Link to="/login" className="mb-10 inline-flex items-center gap-2 text-lg font-bold text-ink lg:hidden"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white"><ChartNoAxesCombined size={19} /></span>SmartSpend</Link>
        <div className="mb-8">
          <p className="text-sm font-semibold text-brand">{mode === 'local' ? 'LOCAL DEVELOPMENT' : 'SECURE ACCOUNT'}</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">{titles[view]}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{descriptions[view]}</p>
        </div>
        <form className="space-y-5" onSubmit={submit}>
          {(view === 'login' || view === 'register' || view === 'forgot') && <TextField label="Email address" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />}
          {view === 'register' && <TextField label="Your name" autoComplete="name" required minLength={1} maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Alex Rivera" />}
          {view === 'login' && mode === 'cognito' && <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" />}
          {view === 'register' && <TextField label="Password" type="password" autoComplete="new-password" required minLength={12} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,}" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters" hint="Use 12+ characters with uppercase, lowercase, a number, and a symbol." />}
          {isCode && <TextField label="Verification code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value)} placeholder="Enter the code from your email" />}
          {view === 'reset' && <TextField label="New password" type="password" autoComplete="new-password" required minLength={12} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,}" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="At least 12 characters" hint="Use 12+ characters with uppercase, lowercase, a number, and a symbol." />}
          {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-700">{error}</div>}
          {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-5 text-emerald-800">{notice}</div>}
          <Button className="w-full" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : view === 'login' ? 'Sign in' : view === 'register' ? 'Create account' : view === 'confirm' ? 'Verify email' : view === 'forgot' ? 'Send reset code' : 'Update password'}
            {!busy && <ArrowRight size={17} />}
          </Button>
        </form>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          {view === 'login' && mode === 'cognito' && <button type="button" onClick={() => { setView('forgot'); setError(''); setNotice(''); }} className="font-semibold text-brand hover:text-brand-dark">Forgot password?</button>}
          {view === 'login' && mode === 'cognito' && <span className="text-muted">New here? <button type="button" onClick={() => { setView('register'); setError(''); setNotice(''); }} className="font-semibold text-brand hover:text-brand-dark">Create account</button></span>}
          {view !== 'login' && <button type="button" onClick={() => { setView('login'); setError(''); setNotice(''); }} className="font-semibold text-brand hover:text-brand-dark">Back to sign in</button>}
        </div>
        {mode === 'local' && <p className="mt-8 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">Local-only mode: no password is used or stored. This development identity is not suitable for real accounts or production.</p>}
      </div>
    </section>
  </main>;
}
