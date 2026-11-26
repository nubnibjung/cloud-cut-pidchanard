import { Check, Eye, EyeOff } from 'lucide-react';
import { LogoTile, Wordmark } from '../ui/Logo';
import { useState } from 'react';
import { login, register } from '../../services/api';
import { useServerStatus } from '../../services/session';
import { useAuthStore } from '../../state/authStore';
import { cn } from '../../utils/cn';
import { AnimatedThemeToggler } from '../ui/AnimatedThemeToggler';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Feedback';

const MIN_PASSWORD = 8;

// `auth-field` (styles.css) keeps browser autofill from repainting the field blue
const FIELD =
  'auth-field h-11 w-full rounded-full border border-transparent bg-ink/[0.07] px-5 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:bg-ink/10 focus:border-ink/25 focus:bg-ink/10 focus:outline-none';

export function LoginPage() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const serverStatus = useServerStatus((state) => state.status);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isLogin = mode === 'login';
  const passwordOk = password.length >= MIN_PASSWORD;

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = isLogin
        ? await login(email, password)
        : await register(email, password, name.trim());
      setAuth(res.access_token, res.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(
        !message || message === 'Failed to fetch'
          ? "Can't reach the server. Check your connection and try again."
          : message,
      );
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(isLogin ? 'register' : 'login');
    setError('');
    setShowPassword(false);
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      {/* Soft light behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgba(45,212,191,0.14),transparent_70%),radial-gradient(40%_40%_at_85%_100%,rgba(255,255,255,0.05),transparent_70%)]"
      />

      <AnimatedThemeToggler className="absolute right-4 top-4" />

      <main className="relative w-full max-w-sm animate-pop-in rounded-3xl border border-ink/10 bg-ink/[0.04] px-7 pb-7 pt-9 shadow-card backdrop-blur-xl">
        <div className="mb-7 flex flex-col items-center gap-4">
          <LogoTile size="lg" className="shadow-[0_10px_30px_-10px_rgb(var(--c-accent)/0.6)]" />
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-fg">
              {isLogin ? <Wordmark className="text-xl" /> : 'Create your account'}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              {isLogin ? 'Sign in to keep editing' : 'Start cutting video in your browser'}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {!isLogin && (
            <input
              type="text"
              required
              autoFocus
              autoComplete="name"
              aria-label="Name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
            />
          )}
          <input
            type="email"
            required
            autoComplete="email"
            aria-label="Email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD}
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={MIN_PASSWORD}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              aria-label="Password"
              aria-describedby={isLogin ? undefined : 'password-rule'}
              placeholder={isLogin ? 'Password' : 'Create a password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(FIELD, 'pr-12')}
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-ink/10 hover:text-fg"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
            </button>
          </div>

          {!isLogin && (
            <p
              id="password-rule"
              className={cn('flex items-center gap-1.5 px-5 text-xs transition-colors', passwordOk ? 'text-success' : 'text-fg-subtle')}
            >
              <span
                className={cn(
                  'flex h-3.5 w-3.5 items-center justify-center rounded-full border transition-colors',
                  passwordOk ? 'border-success bg-success text-canvas' : 'border-fg-subtle',
                )}
              >
                {passwordOk && <Check aria-hidden className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              At least {MIN_PASSWORD} characters
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
              {error}
            </p>
          )}

          <hr className="my-1 border-ink/10" />

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            {isLogin ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        {(serverStatus === 'waking' || serverStatus === 'unreachable') && (
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-fg-muted" role="status">
            {serverStatus === 'waking' ? (
              <>
                <Spinner className="h-3 w-3 shrink-0" />
                Waking up the server, one moment…
              </>
            ) : (
              "The server isn't responding right now."
            )}
          </p>
        )}

        <p className="mt-5 text-center text-sm text-fg-muted">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            className="rounded font-semibold text-fg underline decoration-fg/30 underline-offset-4 hover:decoration-fg"
            onClick={switchMode}
          >
            {isLogin ? "Sign up, it's free" : 'Sign in'}
          </button>
        </p>
      </main>
    </div>
  );
}
