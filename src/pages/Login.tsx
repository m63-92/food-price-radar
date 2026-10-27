import { LineChart } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export function Login({ sb }: { sb: SupabaseClient }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 올바르지 않습니다.' : error.message);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6" aria-labelledby="login-title">
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-700 text-white" aria-hidden>
            <LineChart size={18} />
          </div>
          <div>
            <h1 id="login-title" className="text-base font-bold">
              식자재 가격 레이더
            </h1>
            <p className="text-xs text-slate-500">관리자 로그인</p>
          </div>
        </div>
        <label className="label" htmlFor="email">
          이메일
        </label>
        <input id="email" type="email" autoComplete="username" className="input mb-3" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="label" htmlFor="password">
          비밀번호
        </label>
        <input id="password" type="password" autoComplete="current-password" className="input mb-4" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && (
          <p role="alert" className="mb-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
        <p className="mt-4 text-xs leading-5 text-slate-500">가격 데이터와 관리 기능은 로그인한 관리자만 볼 수 있습니다. 계정은 Supabase 대시보드에서 관리자가 직접 만듭니다.</p>
      </form>
    </div>
  );
}
