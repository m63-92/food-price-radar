import {
  ArchiveRestore,
  CalendarClock,
  Download,
  FileUp,
  LineChart,
  ListChecks,
  LogOut,
  Menu as MenuIcon,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CategoryModal } from '../components/CategoryModal';
import { CategoryPriceComparison } from '../components/CategoryPriceComparison';
import { CategorySidebar } from '../components/CategorySidebar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CrawlLogDrawer } from '../components/CrawlLogDrawer';
import { DeletedItemsDrawer } from '../components/DeletedItemsDrawer';
import { ImportCsvModal } from '../components/ImportCsvModal';
import { Menu } from '../components/Menu';
import { ProductEditDrawer, type EditResult } from '../components/ProductEditDrawer';
import { ProductPriceHistoryDrawer } from '../components/ProductPriceHistoryDrawer';
import { ProductTable, isOrderable } from '../components/ProductTable';
import { ScheduleModal } from '../components/ScheduleModal';
import { useToast } from '../components/Toast';
import { Drawer, EmptyState, JOB_LABEL, JobBadge, Segmented, SkeletonRows, SOURCE_LABEL } from '../components/ui';
import type { Category, ProductRow, ProductSourceStatus, RefreshJob, SortMode, Source } from '../types';
import { downloadText, toCsv, type ImportRow } from '../lib/domain/csv';
import { formatKst, type UnitView } from '../lib/domain/format';
import { unitOf } from '../lib/domain/units';
import { nextSlotAfter, WEEKDAY_LABEL } from '../lib/domain/schedule';
import { SORT_LABEL, sortProducts } from '../lib/domain/sort';
import { useCategories, useJobs, useMutations, useProducts, useSchedule } from '../lib/queries';
import { useRepo } from '../lib/repo/context';

interface ViewPrefs {
  sort: SortMode;
  source: Source | 'all';
  status: ProductSourceStatus | 'all';
  basis: UnitView;
  /** Q7 필터: 주문 가능 여부 · 마감 시각(이후) · 배송 기간(이내) */
  order: 'all' | 'orderable' | 'not_orderable';
  cutoffAfter: 'all' | '12' | '15' | '18' | '21';
  leadWithin: 'all' | '0' | '1' | '2' | '3';
}
const VIEW_KEY = 'fpr-view';
const DEFAULT_VIEW: ViewPrefs = { sort: 'unit_asc', source: 'all', status: 'all', basis: 'kg', order: 'all', cutoffAfter: 'all', leadWithin: 'all' };

/** 상품명에 제외 키워드가 있으면 true (수집기 fpr_is_excluded 와 같은 규칙) */
function isExcluded(title: string, keywords: string[]): boolean {
  const t = title.toLowerCase();
  return keywords.some((k) => k.trim() && t.includes(k.trim().toLowerCase()));
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* UI 편의 설정만 저장 — 실패해도 동작에는 영향 없음 */
  }
}

type Dialog =
  | { kind: 'none' }
  | { kind: 'category'; category: Category | null }
  | { kind: 'schedule' }
  | { kind: 'edit'; product: ProductRow | null }
  | { kind: 'history'; product: ProductRow }
  | { kind: 'compare' }
  | { kind: 'deleteProduct'; product: ProductRow }
  | { kind: 'deleteCategory'; category: Category }
  | { kind: 'logs' }
  | { kind: 'deleted' }
  | { kind: 'import' };

export function Dashboard({ userEmail, onSignOut, onExitDemo }: { userEmail: string | null; onSignOut?: () => void; onExitDemo?: () => void }) {
  const repo = useRepo();
  const toast = useToast();
  const mut = useMutations();
  const cats = useCategories();
  const categories = useMemo(() => cats.data ?? [], [cats.data]);
  const [activeId, setActiveId] = useState<string | null>(() => readLocal<{ id: string | null }>('fpr-active', { id: null }).id);
  const active = categories.find((c) => c.id === activeId) ?? categories[0] ?? null;
  const products = useProducts(active?.id ?? null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const close = () => setDialog({ kind: 'none' });
  const [view, setView] = useState<ViewPrefs>(() => readLocal(VIEW_KEY, DEFAULT_VIEW));
  const [query, setQuery] = useState('');
  const [purge, setPurge] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => writeLocal(VIEW_KEY, view), [view]);
  useEffect(() => {
    if (active) writeLocal('fpr-active', { id: active.id });
  }, [active]);

  const onJobFinished = useCallback(
    (j: RefreshJob) => {
      const name = j.categoryId ? (categories.find((c) => c.id === j.categoryId)?.name ?? '탭') : '전체';
      if (j.status === 'success') toast('success', `‘${name}’ 갱신 완료 — 최신 가격과 그래프에 반영했습니다.`);
      else if (j.status === 'partial') toast('error', `‘${name}’ 갱신 일부 실패 — 실패한 제공처는 이전 정상값을 유지합니다. 수집 로그를 확인하세요.`);
      else if (j.status === 'failed') toast('error', `‘${name}’ 갱신 실패: ${j.errorSummary ?? '수집 로그 확인'}`);
    },
    [categories, toast],
  );
  const jobs = useJobs(onJobFinished);
  const activeJob = (jobs.data ?? []).find((j) => (j.categoryId === active?.id || j.categoryId == null) && (j.status === 'queued' || j.status === 'running'));

  const basis = active?.unitBasis ?? 'kg';
  const { visible: allVisible, excludedCount } = useMemo(() => {
    const ex = active?.excludeKeywords ?? [];
    const list = products.data ?? [];
    const visible = ex.length ? list.filter((p) => !isExcluded(p.effective.title, ex)) : list;
    return { visible, excludedCount: list.length - visible.length };
  }, [products.data, active?.excludeKeywords]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allVisible.filter((p) => {
      const ord = isOrderable(p);
      const cutoffHour = p.orderCutoff ? Number(p.orderCutoff.slice(0, 2)) : null;
      return (
        (view.source === 'all' || p.source === view.source) &&
        (view.status === 'all' || p.sourceStatus === view.status) &&
        (view.order === 'all' || (view.order === 'orderable' ? ord === true : ord === false)) &&
        (view.cutoffAfter === 'all' || (cutoffHour != null && cutoffHour >= Number(view.cutoffAfter))) &&
        (view.leadWithin === 'all' || (p.deliveryLeadDays != null && p.deliveryLeadDays <= Number(view.leadWithin))) &&
        (!q || p.effective.title.toLowerCase().includes(q) || (p.effective.seller ?? '').toLowerCase().includes(q))
      );
    });
    return sortProducts(filtered, view.sort, basis);
  }, [allVisible, view, query, basis]);
  const filtersActive = view.order !== 'all' || view.cutoffAfter !== 'all' || view.leadWithin !== 'all' || view.source !== 'all' || view.status !== 'all' || !!query;

  const fail = (e: unknown) => toast('error', (e as Error).message || '요청을 처리하지 못했습니다.');

  const requestRefresh = (categoryId: string | null) =>
    mut.requestRefresh.mutate(categoryId, {
      onSuccess: (job) => {
        if (repo.mode === 'demo') toast('info', '데모 모드: 갱신 요청이 대기열에 기록되었지만 실제 수집기는 실행되지 않습니다.');
        else if (job.dispatchStatus === 'sent') toast('info', '갱신 요청됨 — 대기 중입니다. 수집이 끝나면 자동으로 반영됩니다.');
        else toast('info', `갱신 요청됨 — 대기 중. ${job.dispatchError ?? '다음 정기 실행(5분 간격, 지연 가능)에서 처리됩니다.'}`);
      },
      onError: fail,
    });

  const exportCategoryCsv = () => {
    if (!active) return;
    const header = ['상품명', '주문', '주문 불가 사유', '주문 마감', '예상 배송', '중량 원문', '총중량(kg)', '개수', '정상가', '할인가', '쿠폰가', '쿠폰 적용 가능', '최저 유효가', '적용 가격', `단가(원/${basis === 'piece' ? active.pieceLabel : 'kg'})`, '배송비 상태', '배송비', '무료배송 기준', '상태', '판매처', '판매자', 'URL'];
    const data = rows.map((p) => {
      const ord = isOrderable(p);
      return [
        p.effective.title, ord == null ? '' : ord ? '가능' : '불가', p.orderStatusReason, p.orderCutoff, p.deliveryNote, p.effective.rawWeightText, p.effective.weightKg,
        p.effective.pieceCount, p.effective.regularPriceKrw, p.effective.salePriceKrw, p.effective.couponPriceKrw, p.effective.couponEligible, p.effectivePriceKrw,
        p.effectivePriceKind, unitOf(p, basis), p.effective.shippingStatus, p.effective.shippingPriceKrw, p.shippingFreeThresholdKrw, p.sourceStatus,
        SOURCE_LABEL[p.source], p.effective.seller, p.effective.sourceUrl,
      ];
    });
    downloadText(`${active.name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, data));
  };

  const exportBackup = async () => {
    try {
      const data = await repo.exportBackup();
      downloadText(`food-price-radar-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
      toast('success', '백업 파일을 내려받았습니다 (토큰·비밀키 미포함).');
    } catch (e) {
      fail(e);
    }
  };

  const onSaveProduct = (r: EditResult) => {
    if (!active) return;
    if (r.mode === 'add') {
      mut.addProduct.mutate(
        { categoryId: active.id, source: r.source ?? 'manual', fields: r.fields },
        { onSuccess: () => (toast('success', '상품을 추가했습니다.'), close()), onError: fail },
      );
    } else if (dialog.kind === 'edit' && dialog.product) {
      mut.saveEdit.mutate(
        { id: dialog.product.id, changes: r.changes, revert: r.revert },
        { onSuccess: () => (toast('success', '저장했습니다. 단가를 다시 계산하고 수정 시점 이력을 남겼습니다.'), close()), onError: fail },
      );
    }
  };

  const onImport = async (items: ImportRow[]) => {
    if (!active) return;
    let ok = 0;
    for (const it of items) {
      try {
        await mut.addProduct.mutateAsync({ categoryId: active.id, source: it.source, fields: it.fields });
        ok++;
      } catch (e) {
        fail(e);
        break;
      }
    }
    toast(ok === items.length ? 'success' : 'error', `${ok}/${items.length}개 상품을 등록했습니다.`);
    close();
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          <div className="mr-auto flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-700 text-white" aria-hidden>
              <LineChart size={17} />
            </div>
            <h1 className="text-base font-bold tracking-tight">식자재 가격 레이더</h1>
            {repo.mode === 'demo' && <span className="chip bg-amber-100 text-amber-800">데모 · 가상 데이터</span>}
          </div>
          <button className="btn-primary" onClick={() => requestRefresh(null)} disabled={mut.requestRefresh.isPending || categories.length === 0}>
            <RefreshCw size={15} /> 전체 갱신
          </button>
          <button className="btn-secondary" onClick={() => setDialog({ kind: 'logs' })}>
            <ListChecks size={15} /> <span className="hidden sm:inline">수집 로그</span>
          </button>
          <Menu
            label="설정"
            trigger={<Settings2 size={16} />}
            items={[
              { label: '삭제한 항목 복구', icon: <ArchiveRestore size={15} />, onSelect: () => setDialog({ kind: 'deleted' }) },
              { label: '전체 백업 내려받기 (JSON)', icon: <Download size={15} />, onSelect: exportBackup },
              { label: '데모 데이터 초기화', icon: <RefreshCw size={15} />, hidden: repo.mode !== 'demo', onSelect: () => ((repo as unknown as { reset: () => void }).reset(), location.reload()) },
              { label: '데모 종료 (설정 화면)', icon: <LogOut size={15} />, hidden: !onExitDemo, onSelect: () => onExitDemo?.() },
              { label: `로그아웃${userEmail ? ` (${userEmail})` : ''}`, icon: <LogOut size={15} />, hidden: !onSignOut, onSelect: () => onSignOut?.() },
            ]}
          />
        </div>
      </header>

      {/* 모바일: 현재 품목 + 목록 열기 버튼 */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
        <button className="btn-secondary" onClick={() => setNavOpen(true)} aria-label="품목 목록 열기">
          <MenuIcon size={15} /> {active?.name ?? '품목'}
        </button>
        <span className="text-xs text-slate-500">품목 {categories.length}개</span>
      </div>
      {navOpen && (
        <Drawer open onClose={() => setNavOpen(false)} title="품목" width="max-w-xs">
          <CategorySidebar
            categories={categories}
            activeId={active?.id ?? null}
            onSelect={(id) => (setActiveId(id), setNavOpen(false))}
            onReorder={(ids) => mut.reorderCategories.mutate(ids, { onError: fail })}
            onAdd={() => (setNavOpen(false), setDialog({ kind: 'category', category: null }))}
          />
        </Drawer>
      )}

      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-5 sm:px-6">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-4">
            {cats.isLoading ? (
              <SkeletonRows rows={4} />
            ) : (
              <CategorySidebar
                categories={categories}
                activeId={active?.id ?? null}
                onSelect={setActiveId}
                onReorder={(ids) => mut.reorderCategories.mutate(ids, { onError: fail })}
                onAdd={() => setDialog({ kind: 'category', category: null })}
              />
            )}
          </div>
        </aside>

      <main className="min-w-0 flex-1">
        {!cats.isLoading && categories.length === 0 && (
          <div className="card">
            <EmptyState icon={<PackageSearch size={20} />} title="품목이 없습니다">
              <button className="btn-primary mt-3" onClick={() => setDialog({ kind: 'category', category: null })}>
                <Plus size={15} /> 품목 추가
              </button>
            </EmptyState>
          </div>
        )}

        {active && (
          <>
            <section className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold tracking-tight">{active.name}</h2>
                  <span className="num text-sm text-slate-500">· 상품 {allVisible.length}개</span>
                  {basis === 'piece' && <span className="chip bg-slate-100 text-slate-600">원/{active.pieceLabel} 기준</span>}
                  <JobBadge status={activeJob?.status ?? active.lastJobStatus} />
                </div>
                <p className="num mt-1 text-[13px] text-slate-500">
                  최근 성공 갱신 {formatKst(active.lastSuccessAt)} KST
                  {activeJob && ` · ${JOB_LABEL[activeJob.status]} (요청 ${formatKst(activeJob.requestedAt).slice(11)})`}
                </p>
                <ScheduleLine categoryId={active.id} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => setDialog({ kind: 'category', category: active })}>
                  <Settings2 size={15} /> 품목 설정
                </button>
                <button className="btn-secondary" onClick={() => setDialog({ kind: 'schedule' })}>
                  <CalendarClock size={15} /> 자동 갱신
                </button>
                <button className="btn-secondary" onClick={() => requestRefresh(active.id)} disabled={mut.requestRefresh.isPending}>
                  <RefreshCw size={15} /> 이 탭 갱신
                </button>
                <button className="btn-secondary" onClick={() => setDialog({ kind: 'compare' })}>
                  <LineChart size={15} /> 가격 추이 비교
                </button>
                <button className="btn-primary" onClick={() => setDialog({ kind: 'edit', product: null })}>
                  <Plus size={15} /> 상품 추가
                </button>
                <Menu
                  items={[
                    { label: 'CSV 가져오기 (수동 등록)', icon: <FileUp size={15} />, onSelect: () => setDialog({ kind: 'import' }) },
                    { label: '이 탭 CSV 내보내기', icon: <Download size={15} />, onSelect: exportCategoryCsv },
                    { label: '삭제한 상품 복구', icon: <ArchiveRestore size={15} />, onSelect: () => setDialog({ kind: 'deleted' }) },
                    { label: '탭 삭제', icon: <Trash2 size={15} />, danger: true, onSelect: () => (setPurge(false), setDialog({ kind: 'deleteCategory', category: active })) },
                  ]}
                />
              </div>
            </section>

            <div className="card">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input pl-8" placeholder="상품명·판매자 검색" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="상품명 검색" />
                </div>
                <select className="input w-auto" value={view.source} onChange={(e) => setView({ ...view, source: e.target.value as ViewPrefs['source'] })} aria-label="판매처 필터">
                  <option value="all">판매처: 전체</option>
                  {(['foodspring', 'naver', 'coupang', 'manual'] as Source[]).map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABEL[s]}
                    </option>
                  ))}
                </select>
                <select className="input w-auto" value={view.status} onChange={(e) => setView({ ...view, status: e.target.value as ViewPrefs['status'] })} aria-label="수집 상태 필터">
                  <option value="all">상태: 전체</option>
                  <option value="ok">성공</option>
                  <option value="stale">수집 실패(이전값)</option>
                  <option value="needs_review">검토 필요</option>
                  <option value="manual">수동</option>
                </select>
                <select className="input w-auto" value={view.order} onChange={(e) => setView({ ...view, order: e.target.value as ViewPrefs['order'] })} aria-label="주문 가능 여부 필터">
                  <option value="all">주문: 전체</option>
                  <option value="orderable">주문 가능</option>
                  <option value="not_orderable">주문 불가</option>
                </select>
                <select className="input w-auto" value={view.cutoffAfter} onChange={(e) => setView({ ...view, cutoffAfter: e.target.value as ViewPrefs['cutoffAfter'] })} aria-label="주문 마감 시간 필터">
                  <option value="all">마감: 전체</option>
                  <option value="12">12시 이후 마감</option>
                  <option value="15">15시 이후 마감</option>
                  <option value="18">18시 이후 마감</option>
                  <option value="21">21시 이후 마감</option>
                </select>
                <select className="input w-auto" value={view.leadWithin} onChange={(e) => setView({ ...view, leadWithin: e.target.value as ViewPrefs['leadWithin'] })} aria-label="예상 배송 기간 필터">
                  <option value="all">배송: 전체</option>
                  <option value="0">당일 도착</option>
                  <option value="1">D+1 이내</option>
                  <option value="2">D+2 이내</option>
                  <option value="3">D+3 이내</option>
                </select>
                <select className="input w-auto" value={view.sort} onChange={(e) => setView({ ...view, sort: e.target.value as SortMode })} aria-label="정렬">
                  {(Object.keys(SORT_LABEL) as SortMode[]).map((s) => (
                    <option key={s} value={s}>
                      정렬: {SORT_LABEL[s]}
                    </option>
                  ))}
                </select>
                {filtersActive && (
                  <button className="btn-ghost btn-sm" onClick={() => (setView({ ...DEFAULT_VIEW, sort: view.sort, basis: view.basis }), setQuery(''))}>
                    필터 초기화
                  </button>
                )}
                <div className={basis === 'piece' ? 'hidden' : 'ml-auto'}>
                  <Segmented<UnitView>
                    size="xs"
                    label="단가 단위"
                    value={view.basis}
                    onChange={(b) => setView({ ...view, basis: b })}
                    options={[
                      { value: 'kg', label: '원/kg' },
                      { value: '100g', label: '원/100g' },
                    ]}
                  />
                </div>
              </div>
              {products.isLoading ? (
                <SkeletonRows rows={6} />
              ) : products.isError ? (
                <p role="alert" className="p-4 text-sm text-red-600">
                  상품을 불러오지 못했습니다: {(products.error as Error).message}
                </p>
              ) : allVisible.length === 0 && excludedCount === 0 ? (
                <EmptyState icon={<PackageSearch size={20} />} title="아직 수집한 상품이 없습니다">
                  ‘이 탭 갱신’으로 수집을 요청하거나 ‘+ 상품 추가’로 직접 등록하세요. 검색어: {active.keywords.join(', ') || active.name}
                </EmptyState>
              ) : rows.length === 0 ? (
                <EmptyState icon={<Search size={20} />} title="조건에 맞는 상품이 없습니다" />
              ) : (
                <ProductTable
                  rows={rows}
                  category={active}
                  view={view.basis}
                  onHistory={(p) => setDialog({ kind: 'history', product: p })}
                  onEdit={(p) => setDialog({ kind: 'edit', product: p })}
                  onDelete={(p) => setDialog({ kind: 'deleteProduct', product: p })}
                />
              )}
            </div>
            <div className="mt-2 space-y-1 text-[12px] leading-5 text-slate-500">
              {excludedCount > 0 && (
                <p>
                  제외 키워드({active.excludeKeywords.join(', ')})에 해당하는 상품 {excludedCount}개를 숨겼습니다. 다음 갱신부터는 수집하지 않습니다.
                </p>
              )}
              <p>
                * 단가 = 정상가·할인가·<b>적용 가능한</b> 쿠폰가 중 최저가 ÷ {basis === 'piece' ? `개수(${active.pieceLabel})` : '총중량'}. 배송비·최소구매금액은 포함하지 않습니다. 주문 가능 여부와 마감은 마지막 갱신 시각 기준이며, 값이 없으면 ‘-’로 표시합니다.
              </p>
            </div>
          </>
        )}
      </main>
      </div>

      {dialog.kind === 'category' && (
        <CategoryModal
          open
          initial={dialog.category}
          busy={mut.createCategory.isPending || mut.updateCategory.isPending}
          onClose={close}
          onSave={(input) =>
            dialog.category
              ? mut.updateCategory.mutate({ id: dialog.category.id, patch: input }, { onSuccess: () => (toast('success', '저장했습니다.'), close()), onError: fail })
              : mut.createCategory.mutate(input, {
                  onSuccess: (c) => {
                    setActiveId(c.id);
                    toast('success', `‘${c.name}’ 탭을 만들었습니다. ‘자동 갱신’에서 예약 시간을 설정하세요.`);
                    close();
                  },
                  onError: fail,
                })
          }
        />
      )}
      {dialog.kind === 'schedule' && active && <ScheduleDialog category={active} onClose={close} />}
      {dialog.kind === 'edit' && <ProductEditDrawer open product={dialog.product} busy={mut.addProduct.isPending || mut.saveEdit.isPending} onSave={onSaveProduct} onClose={close} />}
      {dialog.kind === 'history' && <ProductPriceHistoryDrawer product={(products.data ?? []).find((p) => p.id === dialog.product.id) ?? dialog.product} category={active!} onClose={close} />}
      {dialog.kind === 'compare' && active && <CategoryPriceComparison category={active} products={sortProducts(allVisible, 'unit_asc', basis)} onClose={close} />}
      {dialog.kind === 'logs' && <CrawlLogDrawer categories={categories} onClose={close} />}
      {dialog.kind === 'deleted' && <DeletedItemsDrawer category={active} onClose={close} />}
      {dialog.kind === 'import' && <ImportCsvModal open busy={mut.addProduct.isPending} onImport={onImport} onClose={close} />}
      {dialog.kind === 'deleteProduct' && (
        <ConfirmDialog
          open
          danger
          title="상품 삭제"
          confirmLabel="삭제"
          busy={mut.deleteProduct.isPending}
          onClose={close}
          onConfirm={() => mut.deleteProduct.mutate(dialog.product.id, { onSuccess: () => (toast('success', '삭제했습니다. 설정 → 삭제한 항목 복구에서 되돌릴 수 있습니다.'), close()), onError: fail })}
        >
          ‘{dialog.product.effective.title}’을(를) 목록에서 숨깁니다. 다음 자동 수집에서 같은 상품이 다시 나타나지 않으며, 가격 이력은 보존됩니다.
        </ConfirmDialog>
      )}
      {dialog.kind === 'deleteCategory' && (
        <ConfirmDialog
          open
          danger
          title="품목 탭 삭제"
          confirmLabel={purge ? '탭 삭제 + 이력 영구 삭제' : '탭 삭제'}
          busy={mut.deleteCategory.isPending}
          onClose={close}
          onConfirm={() =>
            mut.deleteCategory.mutate(
              { id: dialog.category.id, purge },
              { onSuccess: () => (toast('success', `‘${dialog.category.name}’ 탭을 삭제했습니다.`), setActiveId(null), close()), onError: fail },
            )
          }
        >
          <p>‘{dialog.category.name}’ 탭을 숨기고 자동 갱신을 끕니다. 상품·가격 이력은 보존되며 ‘삭제한 항목 복구’에서 되돌릴 수 있습니다.</p>
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-[13px] text-red-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-600" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
            가격 이력도 영구 삭제합니다 (되돌릴 수 없음)
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}

function ScheduleLine({ categoryId }: { categoryId: string }) {
  const q = useSchedule(categoryId);
  const s = q.data;
  if (!s) return null;
  if (!s.enabled) return <p className="mt-0.5 text-[13px] text-slate-500">자동 갱신 꺼짐</p>;
  const next = nextSlotAfter(s, Date.now());
  const desc =
    s.frequency === 'interval'
      ? `${s.intervalHours}시간 간격`
      : `${s.frequency === 'weekly' ? s.daysOfWeek.map((d) => WEEKDAY_LABEL[d]).join('·') : '매일'} ${s.timesOfDay.join(', ')}`;
  return (
    <p className="num mt-0.5 text-[13px] text-slate-500">
      자동 갱신 {desc} · 다음 예정 {next ? formatKst(new Date(next).toISOString()) : '-'}
    </p>
  );
}

function ScheduleDialog({ category, onClose }: { category: Category; onClose: () => void }) {
  const q = useSchedule(category.id);
  const { saveSchedule } = useMutations();
  const toast = useToast();
  if (!q.data) return null;
  return (
    <ScheduleModal
      open
      schedule={q.data}
      lastSuccessAt={category.lastSuccessAt}
      busy={saveSchedule.isPending}
      onClose={onClose}
      onSave={(s) =>
        saveSchedule.mutate(s, {
          onSuccess: () => (toast('success', '자동 갱신 설정을 저장했습니다.'), onClose()),
          onError: (e) => toast('error', (e as Error).message),
        })
      }
    />
  );
}
