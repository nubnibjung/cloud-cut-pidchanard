import { Scissors } from 'lucide-react';
import { useState } from 'react';
import { login, register } from '../../services/api';
import { useAuthStore } from '../../state/authStore';

export function LoginPage() {
  const { setAuth } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await login(email, password)
        : await register(email, password, name);
      setAuth(res.access_token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0d0f14]">
      <div className="w-full max-w-sm rounded-xl border border-border bg-[#151820] p-8 shadow-2xl">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <Scissors className="h-6 w-6 text-accent" />
            <span className="text-xl font-bold">CloudCut</span>
          </div>
          <p className="text-sm text-slate-400">Collaborative video editor</p>
        </div>

        <div className="mb-6 flex rounded-lg border border-border bg-[#0d0f14] p-1">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === m ? 'bg-accent text-black' : 'text-slate-400 hover:text-white'}`}
              onClick={() => setMode(m)}
            >
              {m === 'login' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {mode === 'register' && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-300">Name</span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="rounded-lg border border-border bg-[#0d0f14] px-3 py-2 text-white outline-none focus:border-accent"
              />
            </label>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-slate-300">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-lg border border-border bg-[#0d0f14] px-3 py-2 text-white outline-none focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-slate-300">Password</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-lg border border-border bg-[#0d0f14] px-3 py-2 text-white outline-none focus:border-accent"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-black transition-opacity disabled:opacity-60"
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Demo: alice@cloudcut.test / password123
        </p>
      </div>
    </div>
  );
}
