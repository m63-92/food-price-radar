import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { CategorySchedule, ChartPreferences, EditableField, EditableFields, RangeKey, RefreshJob, Source } from '../types';
import { useRepo } from './repo/context';
import type { CategoryInput, FieldChange, OriginFilter } from './repo/types';

export const qk = {
  categories: (deleted = false) => ['categories', deleted] as const,
  products: (categoryId: string, deleted = false) => ['products', categoryId, deleted] as const,
  schedule: (categoryId: string) => ['schedule', categoryId] as const,
  history: (productId: string, range: RangeKey, origin: OriginFilter) => ['history', productId, range, origin] as const,
  comparison: (categoryId: string, ids: string[], range: RangeKey) => ['comparison', categoryId, ids.join(','), range] as const,
  events: (productId: string) => ['events', productId] as const,
  prefs: (categoryId: string) => ['prefs', categoryId] as const,
  jobs: ['jobs'] as const,
  runs: ['runs'] as const,
  providers: ['providers'] as const,
};

export const useCategories = (deleted = false) => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.categories(deleted), queryFn: () => repo.listCategories(deleted) });
};

export const useProducts = (categoryId: string | null, deleted = false) => {
  const repo = useRepo();
  return useQuery({
    queryKey: qk.products(categoryId ?? '-', deleted),
    queryFn: () => repo.listProducts(categoryId!, deleted),
    enabled: !!categoryId,
  });
};

export const useSchedule = (categoryId: string) => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.schedule(categoryId), queryFn: () => repo.getSchedule(categoryId) });
};

export const useHistory = (productId: string, range: RangeKey, origin: OriginFilter) => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.history(productId, range, origin), queryFn: () => repo.getProductPriceHistory(productId, range, origin) });
};

export const useComparison = (categoryId: string, ids: string[], range: RangeKey) => {
  const repo = useRepo();
  return useQuery({
    queryKey: qk.comparison(categoryId, ids, range),
    queryFn: () => repo.getCategoryPriceComparison(categoryId, ids, range),
    enabled: ids.length > 0,
  });
};

export const useChangeEvents = (productId: string) => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.events(productId), queryFn: () => repo.listChangeEvents(productId) });
};

export const useChartPrefs = (categoryId: string) => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.prefs(categoryId), queryFn: () => repo.getChartPreferences(categoryId) });
};

export const useProviders = () => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.providers, queryFn: () => repo.getProviderStatuses(), staleTime: 60_000 });
};

export const useCrawlRuns = (enabled: boolean) => {
  const repo = useRepo();
  return useQuery({ queryKey: qk.runs, queryFn: () => repo.listCrawlRuns(80), enabled });
};

const ACTIVE = new Set(['queued', 'running']);

/**
 * 작업 큐 상태. 대기/실행 중인 작업이 있으면 15초마다 다시 조회하고,
 * 작업이 '완료(success/partial/failed)'로 바뀌는 순간에만 상품·이력 캐시를 무효화한다.
 * (요청 직후에는 '대기 중'으로만 표시 — 실제 수집 종료 전 완료 표시 금지)
 */
export function useJobs(onFinished?: (job: RefreshJob) => void) {
  const repo = useRepo();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.jobs,
    queryFn: () => repo.listRefreshJobs(80),
    refetchInterval: (query) => ((query.state.data ?? []).some((j) => ACTIVE.has(j.status)) ? 15_000 : 120_000),
  });
  const prev = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const jobs = q.data ?? [];
    let finished = false;
    for (const j of jobs) {
      const before = prev.current.get(j.id);
      if (before && ACTIVE.has(before) && !ACTIVE.has(j.status)) {
        finished = true;
        onFinished?.(j);
      }
    }
    prev.current = new Map(jobs.map((j) => [j.id, j.status]));
    if (finished) {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['comparison'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: qk.runs });
      qc.invalidateQueries({ queryKey: qk.providers });
    }
  }, [q.data, qc, onFinished]);
  return q;
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['categories', 'products', 'history', 'comparison', 'events', 'jobs', 'schedule', 'prefs']) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

export function useMutations() {
  const repo = useRepo();
  const invalidate = useInvalidateAll();
  // 고정된 순서로만 호출되는 훅 팩토리
  const useM = <A, R>(fn: (a: A) => Promise<R>) => useMutation({ mutationFn: fn, onSuccess: invalidate });
  const m = useM;
  return {
    createCategory: m((i: CategoryInput) => repo.createCategory(i)),
    updateCategory: m((a: { id: string; patch: Partial<CategoryInput> }) => repo.updateCategory(a.id, a.patch)),
    reorderCategories: m((ids: string[]) => repo.reorderCategories(ids)),
    deleteCategory: m((a: { id: string; purge: boolean }) => repo.deleteCategory(a.id, a.purge)),
    restoreCategory: m((id: string) => repo.restoreCategory(id)),
    addProduct: m((a: { categoryId: string; source: Source; fields: EditableFields }) => repo.addManualProduct(a.categoryId, a.source, a.fields)),
    saveEdit: m((a: { id: string; changes: Partial<Record<EditableField, FieldChange>>; revert: EditableField[] }) =>
      repo.saveProductEdit(a.id, a.changes, a.revert),
    ),
    deleteProduct: m((id: string) => repo.deleteProduct(id)),
    restoreProduct: m((id: string) => repo.restoreProduct(id)),
    saveSchedule: m((s: CategorySchedule) => repo.saveSchedule(s)),
    savePrefs: m((p: ChartPreferences) => repo.saveChartPreferences(p)),
    requestRefresh: m((categoryId: string | null) => repo.requestRefresh(categoryId)),
  };
}
