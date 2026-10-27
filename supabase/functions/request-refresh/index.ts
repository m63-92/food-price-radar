// 수동 갱신 요청: 로그인 사용자 확인 → 작업 큐 생성(RLS/RPC) → GitHub workflow_dispatch.
// dispatch 가 실패해도 큐는 남아 다음 정기 실행(5분 간격)에서 처리된다.
// Secrets(Edge Function 전용): GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW_FILE, GITHUB_DISPATCH_TOKEN
//   GITHUB_DISPATCH_TOKEN 은 해당 저장소 Actions: write 권한만 가진 fine-grained PAT 또는 GitHub App 토큰.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: '로그인이 필요합니다.' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 사용자 JWT 로 RPC 호출 → auth.uid()·소유권 검사가 DB 에서 수행된다
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: '인증이 유효하지 않습니다.' }, 401);

  let categoryId: string | null = null;
  try {
    const body = await req.json();
    categoryId = typeof body?.categoryId === 'string' ? body.categoryId : null;
  } catch {
    /* 본문 없음 = 전체 갱신 */
  }

  const { data: job, error: jobErr } = await userClient.rpc('fpr_enqueue_refresh', { p_category_id: categoryId });
  if (jobErr || !job) return json({ error: jobErr?.message ?? '작업을 만들 수 없습니다.' }, 403);

  const admin = createClient(url, serviceKey);
  const owner = Deno.env.get('GITHUB_OWNER');
  const repo = Deno.env.get('GITHUB_REPO');
  const workflow = Deno.env.get('GITHUB_WORKFLOW_FILE') ?? 'crawl.yml';
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  const ref = Deno.env.get('GITHUB_REF') ?? 'main';

  let dispatchStatus: 'sent' | 'failed' | 'not_configured' = 'not_configured';
  let dispatchError: string | null = null;
  if (owner && repo && token) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'food-price-radar',
        },
        body: JSON.stringify({ ref, inputs: { reason: 'manual', job_id: job.id } }),
      });
      if (res.status === 204) dispatchStatus = 'sent';
      else {
        dispatchStatus = 'failed';
        dispatchError = `GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`;
      }
    } catch (e) {
      dispatchStatus = 'failed';
      dispatchError = String(e).slice(0, 300);
    }
  }
  await admin.from('refresh_jobs').update({ dispatch_status: dispatchStatus, dispatch_error: dispatchError }).eq('id', job.id);

  return json({ job: { ...job, dispatch_status: dispatchStatus, dispatch_error: dispatchError } });
});
