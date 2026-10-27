import type {
  Category,
  CategorySchedule,
  ChangeEvent,
  ChartPreferences,
  CrawlRun,
  EditableField,
  EditableFields,
  FieldOverride,
  PriceObservation,
  PriceSnapshot,
  ProductRow,
  ProductSourceStatus,
  ExtractionStatus,
  ProviderStatus,
  RangeKey,
  RefreshJob,
  Source,
} from '../../types';
import { applyOverrides, derive } from '../domain/effective';
import { rangeStartIso, type CategoryInput, type FieldChange, type OriginFilter, type Repo } from './types';

/**
 * 데모 모드 저장소 — Supabase 를 설정하기 전 화면을 둘러보기 위한 것.
 * 데이터는 명세의 "계산 테스트용 가상 데이터"이며 이 브라우저에만 저장된다(실제 운영 데이터와 섞이지 않음).
 * 서버 DB 와 같은 규칙(override 고정, 삭제 tombstone, 관측 append-only)을 메모리에서 흉내낸다.
 */

interface DemoProduct {
  id: string;
  categoryId: string;
  source: Source;
  sourceProductId: string | null;
  isManual: boolean;
  raw: EditableFields;
  overrides: Partial<Record<EditableField, FieldOverride>>;
  sourceStatus: ProductSourceStatus;
  extractionStatus: ExtractionStatus;
  reviewNotes: string[];
  lastSuccessAt: string | null;
  observedAt: string | null;
  deletedAt: string | null;
}

interface DemoState {
  version: 1;
  categories: Array<Omit<Category, 'lastSuccessAt' | 'lastJobStatus' | 'lastJobRequestedAt'>>;
  schedules: Record<string, CategorySchedule>;
  products: DemoProduct[];
  observations: PriceObservation[];
  events: ChangeEvent[];
  jobs: Array<RefreshJob & { ownerCategoryIds?: string[] }>;
  prefs: Record<string, ChartPreferences>;
  audit: Array<{ at: string; entity: string; id: string; action: string; before: unknown; after: unknown }>;
}

const STORAGE_KEY = 'fpr-demo-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const nowIso = () => new Date().toISOString();
const kst = (d: string) => new Date(`${d}+09:00`).toISOString();

function snapshotOf(fields: EditableFields): PriceSnapshot {
  const d = derive(fields);
  return {
    regularPriceKrw: fields.regularPriceKrw,
    salePriceKrw: fields.salePriceKrw,
    couponPriceKrw: fields.couponPriceKrw,
    couponEligible: fields.couponEligible,
    weightKg: fields.weightKg,
    bestPriceKrw: d.bestPriceKrw,
    bestPriceKind: d.kind,
    unitPriceKrwPerKg: d.unitPriceKrwPerKg,
  };
}

function fields(p: Partial<EditableFields> & { title: string }): EditableFields {
  return {
    seller: null,
    productOption: null,
    sourceUrl: 'https://example.invalid/demo',
    rawWeightText: null,
    weightKg: null,
    regularPriceKrw: null,
    salePriceKrw: null,
    couponPriceKrw: null,
    couponEligible: null,
    couponConditions: null,
    shippingStatus: 'unknown',
    shippingPriceKrw: null,
    availability: 'in_stock',
    ...p,
  };
}

function seed(): DemoState {
  const garlic = 'demo-cat-garlic';
  const cabbage = 'demo-cat-cabbage';
  const s: DemoState = {
    version: 1,
    categories: [
      { id: garlic, name: '마늘', sortOrder: 1, keywords: ['깐마늘', '통마늘', '마늘 1kg'], enabledSources: ['foodspring'], trackedUrls: [], deletedAt: null, createdAt: kst('2026-09-30T09:00:00') },
      { id: cabbage, name: '배추', sortOrder: 2, keywords: ['배추', '절임배추'], enabledSources: ['foodspring'], trackedUrls: [], deletedAt: null, createdAt: kst('2026-09-30T09:00:00') },
    ],
    schedules: {
      [garlic]: { categoryId: garlic, enabled: true, timezone: 'Asia/Seoul', frequency: 'daily', daysOfWeek: [], timesOfDay: ['08:30'], intervalHours: null, nextDueAt: null, lastCompletedSlot: null },
      [cabbage]: { categoryId: cabbage, enabled: true, timezone: 'Asia/Seoul', frequency: 'daily', daysOfWeek: [], timesOfDay: ['19:00'], intervalHours: null, nextDueAt: null, lastCompletedSlot: null },
    },
    products: [],
    observations: [],
    events: [],
    jobs: [],
    prefs: {},
    audit: [],
  };
  // 명세 5.4 / 8.4 의 가상 데이터 (실제 쇼핑몰 가격 아님)
  const history: Array<[string, string, Partial<EditableFields>]> = [
    ['A', '2026-10-01T09:00:00', { regularPriceKrw: 12000, salePriceKrw: 10000 }],
    ['A', '2026-10-05T09:00:00', { regularPriceKrw: 12000, salePriceKrw: 9000 }],
    ['A', '2026-10-10T09:00:00', { regularPriceKrw: 12000, salePriceKrw: 9000, couponPriceKrw: 8000, couponEligible: true }],
    ['A', '2026-10-20T09:00:00', { regularPriceKrw: 10000, salePriceKrw: 8000, couponPriceKrw: 7000, couponEligible: true }],
    ['B', '2026-10-10T09:00:00', { regularPriceKrw: 6000, salePriceKrw: 5500 }],
    ['B', '2026-10-15T09:00:00', { regularPriceKrw: 6000, salePriceKrw: 5200 }],
    ['B', '2026-10-20T09:00:00', { regularPriceKrw: 5000, salePriceKrw: 4500 }],
  ];
  const base: Record<string, EditableFields> = {
    A: fields({ title: '[가상] 마늘 A', seller: '데모 판매자', rawWeightText: '1kg', weightKg: 1, shippingStatus: 'paid', shippingPriceKrw: 3000, couponConditions: '데모: 적용 가능으로 확인된 쿠폰' }),
    B: fields({ title: '[가상] 마늘 B', seller: '데모 판매자', rawWeightText: '500g', weightKg: 0.5, shippingStatus: 'free' }),
    C: fields({ title: '[가상] 마늘 C', rawWeightText: '1망', weightKg: null, regularPriceKrw: 3900 }),
  };
  for (const key of ['A', 'B', 'C']) {
    s.products.push({
      id: `demo-p-${key}`,
      categoryId: garlic,
      source: 'manual',
      sourceProductId: null,
      isManual: true,
      raw: base[key],
      overrides: {},
      sourceStatus: key === 'C' ? 'needs_review' : 'manual',
      extractionStatus: key === 'C' ? 'needs_review' : 'verified',
      reviewNotes: key === 'C' ? ['중량 정보 없음 (1망)'] : [],
      lastSuccessAt: null,
      observedAt: null,
      deletedAt: null,
    });
  }
  for (const [key, at, prices] of history) {
    const p = s.products.find((x) => x.id === `demo-p-${key}`)!;
    p.raw = { ...p.raw, couponPriceKrw: null, couponEligible: null, ...prices };
    p.lastSuccessAt = p.observedAt = kst(at);
    const snap = snapshotOf(p.raw);
    s.observations.push({
      id: uid(),
      productId: p.id,
      runId: null,
      observedAt: kst(at),
      origin: 'manual_edit',
      raw: snap,
      effective: snap,
      shippingStatus: p.raw.shippingStatus,
      shippingPriceKrw: p.raw.shippingPriceKrw,
      productOption: p.raw.productOption,
      availability: p.raw.availability,
    });
  }
  const c = s.products.find((x) => x.id === 'demo-p-C')!;
  c.lastSuccessAt = c.observedAt = kst('2026-10-20T09:00:00');
  return s;
}

export class DemoRepo implements Repo {
  readonly mode = 'demo' as const;
  private s: DemoState;

  constructor() {
    this.s = this.load() ?? seed();
  }

  private load(): DemoState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as DemoState) : null;
      return parsed?.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.s));
    } catch {
      /* 저장 불가(사생활 보호 모드 등) — 메모리에서만 유지 */
    }
  }

  reset() {
    this.s = seed();
    this.save();
  }

  private async done<T>(v: T): Promise<T> {
    this.save();
    await new Promise((r) => setTimeout(r, 120));
    return structuredClone(v);
  }

  private toRow(p: DemoProduct): ProductRow {
    const effective = applyOverrides(p.raw, p.overrides);
    const d = derive(effective);
    return {
      id: p.id,
      categoryId: p.categoryId,
      source: p.source,
      sourceProductId: p.sourceProductId,
      sourceOptionId: null,
      isManual: p.isManual,
      raw: p.raw,
      effective,
      overrides: p.overrides,
      effectivePriceKrw: d.bestPriceKrw,
      effectivePriceKind: d.kind,
      unitPriceKrwPerKg: d.unitPriceKrwPerKg,
      sourceStatus: p.sourceStatus,
      extractionStatus: p.extractionStatus,
      reviewNotes: [...p.reviewNotes, ...d.warnings.map((w) => (w === 'coupon_excluded' ? '쿠폰 조건 미확인 → 최저가 제외' : '할인가 > 정상가 표기'))],
      lastSuccessAt: p.lastSuccessAt,
      observedAt: p.observedAt,
      deletedAt: p.deletedAt,
    };
  }

  private appendManualObservation(p: DemoProduct) {
    const effective = applyOverrides(p.raw, p.overrides);
    const prev = this.s.observations.filter((o) => o.productId === p.id).sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
    const o: PriceObservation = {
      id: uid(),
      productId: p.id,
      runId: null,
      observedAt: nowIso(),
      origin: 'manual_edit',
      raw: snapshotOf(p.raw),
      effective: snapshotOf(effective),
      shippingStatus: effective.shippingStatus,
      shippingPriceKrw: effective.shippingPriceKrw,
      productOption: effective.productOption,
      availability: effective.availability,
    };
    this.s.observations.push(o);
    const pb = prev?.effective.bestPriceKrw;
    const nb = o.effective.bestPriceKrw;
    if (pb != null && nb != null && pb !== nb) {
      this.s.events.push({ id: uid(), productId: p.id, observationId: o.id, eventType: nb < pb ? 'price_down' : 'price_up', oldValue: pb, newValue: nb, createdAt: o.observedAt });
    }
    p.observedAt = o.observedAt;
  }

  async listCategories(includeDeleted = false) {
    const cats = this.s.categories
      .filter((c) => includeDeleted || !c.deletedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => {
        const jobs = this.s.jobs.filter((j) => j.categoryId === c.id || j.categoryId == null).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
        return { ...c, lastSuccessAt: null, lastJobStatus: jobs[0]?.status ?? null, lastJobRequestedAt: jobs[0]?.requestedAt ?? null };
      });
    return this.done(cats);
  }

  async createCategory(input: CategoryInput) {
    if (this.s.categories.some((c) => !c.deletedAt && c.name === input.name.trim())) throw new Error('같은 이름의 품목 탭이 이미 있습니다.');
    const c = { id: uid(), name: input.name.trim(), sortOrder: this.s.categories.length + 1, keywords: input.keywords, enabledSources: input.enabledSources, trackedUrls: input.trackedUrls, deletedAt: null, createdAt: nowIso() };
    this.s.categories.push(c);
    this.s.schedules[c.id] = { categoryId: c.id, enabled: false, timezone: 'Asia/Seoul', frequency: 'daily', daysOfWeek: [], timesOfDay: [], intervalHours: null, nextDueAt: null, lastCompletedSlot: null };
    return this.done({ ...c, lastSuccessAt: null, lastJobStatus: null, lastJobRequestedAt: null });
  }

  async updateCategory(id: string, patch: Partial<CategoryInput>) {
    const c = this.s.categories.find((x) => x.id === id);
    if (!c) throw new Error('품목 탭을 찾을 수 없습니다.');
    Object.assign(c, { ...patch, name: patch.name?.trim() ?? c.name });
    return this.done(undefined);
  }

  async reorderCategories(ids: string[]) {
    ids.forEach((id, i) => {
      const c = this.s.categories.find((x) => x.id === id);
      if (c) c.sortOrder = i + 1;
    });
    return this.done(undefined);
  }

  async deleteCategory(id: string, purgeHistory: boolean) {
    const c = this.s.categories.find((x) => x.id === id);
    if (c) c.deletedAt = nowIso();
    if (this.s.schedules[id]) this.s.schedules[id].enabled = false;
    if (purgeHistory) {
      const pids = new Set(this.s.products.filter((p) => p.categoryId === id).map((p) => p.id));
      this.s.observations = this.s.observations.filter((o) => !pids.has(o.productId));
    }
    return this.done(undefined);
  }

  async restoreCategory(id: string) {
    const c = this.s.categories.find((x) => x.id === id);
    if (c) c.deletedAt = null;
    return this.done(undefined);
  }

  async listProducts(categoryId: string, deletedOnly = false) {
    return this.done(this.s.products.filter((p) => p.categoryId === categoryId && !!p.deletedAt === deletedOnly).map((p) => this.toRow(p)));
  }

  async addManualProduct(categoryId: string, source: Source, f: EditableFields) {
    const p: DemoProduct = {
      id: uid(),
      categoryId,
      source,
      sourceProductId: null,
      isManual: true,
      raw: f,
      overrides: {},
      sourceStatus: 'manual',
      extractionStatus: 'verified',
      reviewNotes: [],
      lastSuccessAt: nowIso(),
      observedAt: null,
      deletedAt: null,
    };
    this.s.products.push(p);
    this.appendManualObservation(p);
    this.s.audit.push({ at: nowIso(), entity: 'product', id: p.id, action: 'create_manual', before: null, after: f });
    return this.done(p.id);
  }

  async saveProductEdit(productId: string, changes: Partial<Record<EditableField, FieldChange>>, revert: EditableField[]) {
    const p = this.s.products.find((x) => x.id === productId);
    if (!p) throw new Error('상품을 찾을 수 없습니다.');
    const before = this.toRow(p);
    for (const [f, c] of Object.entries(changes) as Array<[EditableField, FieldChange]>) {
      if (p.isManual) (p.raw as unknown as Record<string, unknown>)[f] = c.value;
      else p.overrides[f] = { value: c.value, isLocked: c.locked, updatedAt: nowIso() };
    }
    for (const f of revert) delete p.overrides[f];
    this.appendManualObservation(p);
    this.s.audit.push({ at: nowIso(), entity: 'product', id: p.id, action: 'edit', before: before.effective, after: this.toRow(p).effective });
    return this.done(undefined);
  }

  async deleteProduct(productId: string) {
    const p = this.s.products.find((x) => x.id === productId);
    if (p) p.deletedAt = nowIso();
    return this.done(undefined);
  }

  async restoreProduct(productId: string) {
    const p = this.s.products.find((x) => x.id === productId);
    if (p) p.deletedAt = null;
    return this.done(undefined);
  }

  async getSchedule(categoryId: string) {
    return this.done(this.s.schedules[categoryId]);
  }

  async saveSchedule(s: CategorySchedule) {
    this.s.schedules[s.categoryId] = s;
    return this.done(undefined);
  }

  async getProductPriceHistory(productId: string, range: RangeKey, originFilter: OriginFilter) {
    const start = rangeStartIso(range);
    return this.done(
      this.s.observations
        .filter((o) => o.productId === productId && (!start || o.observedAt >= start) && (originFilter === 'all' || o.origin === originFilter))
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id)),
    );
  }

  async getCategoryPriceComparison(_categoryId: string, productIds: string[], range: RangeKey) {
    const start = rangeStartIso(range);
    const out: Record<string, PriceObservation[]> = {};
    for (const id of productIds) out[id] = this.s.observations.filter((o) => o.productId === id && (!start || o.observedAt >= start));
    return this.done(out);
  }

  async listChangeEvents(productId: string, limit = 50) {
    return this.done(this.s.events.filter((e) => e.productId === productId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
  }

  async getChartPreferences(categoryId: string) {
    return this.done(this.s.prefs[categoryId] ?? null);
  }

  async saveChartPreferences(p: ChartPreferences) {
    this.s.prefs[p.categoryId] = p;
    return this.done(undefined);
  }

  async requestRefresh(categoryId: string | null): Promise<RefreshJob> {
    const existing = this.s.jobs.find((j) => j.categoryId === categoryId && j.status === 'queued');
    if (existing) return this.done(existing);
    const job: RefreshJob = {
      id: uid(),
      categoryId,
      reason: categoryId ? 'manual_category' : 'manual_all',
      slotKey: null,
      status: 'queued',
      requestedAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      errorSummary: '데모 모드: 실제 수집기는 실행되지 않습니다 (Supabase·GitHub Actions 설정 필요)',
      attemptCount: 0,
      scheduledFor: null,
      dispatchStatus: 'not_configured',
      dispatchError: null,
    };
    this.s.jobs.push(job);
    return this.done(job);
  }

  async listRefreshJobs(limit = 50) {
    return this.done([...this.s.jobs].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, limit));
  }

  async listCrawlRuns(): Promise<CrawlRun[]> {
    return this.done([]);
  }

  async getProviderStatuses(): Promise<ProviderStatus[]> {
    return this.done([
      { source: 'foodspring', state: 'needs_setup', label: '식봄', detail: '데모 모드 — 수집기 미연결. 실제 운영 시 공개 검색/상세 페이지에서 수집(키워드당 상위 8개).', lastRunAt: null, lastRunStatus: null },
      { source: 'naver', state: 'restricted', label: '네이버', detail: '쇼핑 검색 Open API 종료(2026-07-31) · robots.txt 차단 → 수동 등록/CSV 가져오기', lastRunAt: null, lastRunStatus: null },
      { source: 'coupang', state: 'restricted', label: '쿠팡', detail: '구매자용 공식 API 없음 · 웹 접근 거부 → 파트너스 승인 키 설정 시에만, 그 외 수동 등록/CSV', lastRunAt: null, lastRunStatus: null },
    ]);
  }

  async exportBackup() {
    return this.done({
      categories: this.s.categories,
      schedules: Object.values(this.s.schedules),
      products: this.s.products,
      price_observations: this.s.observations,
      change_events: this.s.events,
      refresh_jobs: this.s.jobs,
      audit_logs: this.s.audit,
    } as Record<string, unknown[]>);
  }
}
