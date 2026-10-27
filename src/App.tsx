import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { ToastProvider } from './components/Toast';
import { SkeletonRows } from './components/ui';
import { DemoRepo } from './lib/repo/demoRepo';
import { RepoContext } from './lib/repo/context';
import { SupabaseRepo } from './lib/repo/supabaseRepo';
import type { Repo } from './lib/repo/types';
import { supabase } from './lib/supabase';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';

const DEMO_FLAG = 'fpr-demo-mode';

function readDemo(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG) === '1' || new URLSearchParams(location.search).has('demo');
  } catch {
    return false;
  }
}

function Shell({ repo, children }: { repo: Repo; children: React.ReactNode }) {
  // 저장소가 바뀌면(로그인 사용자/데모 전환) key 로 다시 마운트되어 캐시를 새로 만든다
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: true } } }));
  return (
    <QueryClientProvider client={qc}>
      <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>
    </QueryClientProvider>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [demo, setDemo] = useState(() => !supabase && readDemo());

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  const repo = useMemo<Repo | null>(() => {
    if (supabase && userId) return new SupabaseRepo(supabase);
    if (!supabase && demo) return new DemoRepo();
    return null;
  }, [userId, demo]);

  const enterDemo = () => {
    try {
      localStorage.setItem(DEMO_FLAG, '1');
    } catch {
      /* 플래그 저장 불가 시 이번 세션만 */
    }
    setDemo(true);
  };
  const exitDemo = () => {
    try {
      localStorage.removeItem(DEMO_FLAG);
    } catch {
      /* noop */
    }
    setDemo(false);
  };

  return (
    <ToastProvider>
      {!authReady ? (
        <SkeletonRows rows={4} />
      ) : supabase && !session ? (
        <Login sb={supabase} />
      ) : !repo ? (
        <Setup onDemo={enterDemo} />
      ) : (
        <Shell key={userId ?? 'demo'} repo={repo}>
          <Dashboard
            userEmail={session?.user.email ?? null}
            onSignOut={supabase ? () => supabase!.auth.signOut() : undefined}
            onExitDemo={repo.mode === 'demo' ? exitDemo : undefined}
          />
        </Shell>
      )}
    </ToastProvider>
  );
}
