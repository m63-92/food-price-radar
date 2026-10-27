import type { Category } from '../types';
import { formatKst } from '../lib/domain/format';
import { useCrawlRuns, useJobs, useProviders } from '../lib/queries';
import { Drawer, JobBadge, ProviderBadge, SOURCE_LABEL, SkeletonRows } from './ui';

const REASON: Record<string, string> = { manual_category: '이 탭 갱신', manual_all: '전체 갱신', schedule: '예약' };
const DISPATCH: Record<string, string> = {
  pending: '실행 요청 전',
  sent: 'Actions 실행 요청됨',
  failed: 'Actions 요청 실패 → 정기 실행에서 재시도',
  not_configured: 'Actions 호출 미설정 → 정기 실행에서 처리',
  scheduled: '정기 실행',
};

export function ProviderStatusPanel() {
  const q = useProviders();
  if (q.isLoading) return <SkeletonRows rows={3} />;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {(q.data ?? []).map((p) => (
        <li key={p.source} className="px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{SOURCE_LABEL[p.source]}</span>
            <ProviderBadge state={p.state} />
          </div>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">{p.detail}</p>
          {p.lastRunAt && (
            <p className="num mt-0.5 text-[11px] text-slate-400">
              마지막 수집 {formatKst(p.lastRunAt)} · {p.lastRunStatus}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CrawlLogDrawer({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const jobs = useJobs();
  const runs = useCrawlRuns(true);
  const catName = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? '삭제된 탭') : '전체');
  return (
    <Drawer open onClose={onClose} title="수집 로그 · 제공처 상태" width="max-w-3xl">
      <section className="mb-6">
        <h3 className="mb-2 text-[13px] font-semibold text-slate-700">제공처 연동 상태</h3>
        <ProviderStatusPanel />
      </section>
      <section className="mb-6">
        <h3 className="mb-2 text-[13px] font-semibold text-slate-700">갱신 작업</h3>
        {jobs.isLoading ? (
          <SkeletonRows rows={4} />
        ) : (jobs.data ?? []).length === 0 ? (
          <p className="text-[13px] text-slate-500">아직 갱신 작업이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="num w-full min-w-[620px] text-[12px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {['요청(KST)', '대상', '종류', '상태', '예약 시각 → 시작 (지연)', '종료', '비고'].map((h) => (
                    <th key={h} className="px-2.5 py-2 text-left font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.data!.map((j) => {
                  const delay = j.scheduledFor && j.startedAt ? Math.round((Date.parse(j.startedAt) - Date.parse(j.scheduledFor)) / 60000) : null;
                  return (
                    <tr key={j.id} className="align-top">
                      <td className="px-2.5 py-1.5">{formatKst(j.requestedAt)}</td>
                      <td className="px-2.5 py-1.5">{catName(j.categoryId)}</td>
                      <td className="px-2.5 py-1.5">{REASON[j.reason]}</td>
                      <td className="px-2.5 py-1.5">
                        <JobBadge status={j.status} />
                        {j.attemptCount > 1 && <span className="ml-1 text-slate-400">시도 {j.attemptCount}</span>}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {j.scheduledFor ? `${formatKst(j.scheduledFor).slice(11)} → ${formatKst(j.startedAt).slice(11)}` : formatKst(j.startedAt)}
                        {delay != null && <span className="text-slate-400"> ({delay}분)</span>}
                      </td>
                      <td className="px-2.5 py-1.5">{formatKst(j.finishedAt)}</td>
                      <td className="max-w-[220px] px-2.5 py-1.5 text-slate-500">
                        {j.errorSummary ?? DISPATCH[j.dispatchStatus]}
                        {j.dispatchError && <div className="text-red-600">{j.dispatchError}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-slate-700">제공처별 실행 기록</h3>
        {(runs.data ?? []).length === 0 ? (
          <p className="text-[13px] text-slate-500">수집기 실행 기록이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-[12px]">
            {runs.data!.map((r) => (
              <li key={r.id} className="num px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{SOURCE_LABEL[r.source]}</span>
                  <span className="text-slate-500">{catName(r.categoryId)}</span>
                  <JobBadge status={r.status} />
                  <span className="text-slate-500">
                    {formatKst(r.startedAt)} ~ {formatKst(r.finishedAt).slice(11)}
                  </span>
                  <span className="ml-auto text-slate-600">
                    수집 {r.collectedCount} · 변경 {r.changedCount} · 실패 {r.failedCount}
                  </span>
                </div>
                {r.errorDetail && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] text-red-700">{r.errorDetail}</pre>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}
