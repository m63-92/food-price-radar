import type {
  Category,
  CategorySchedule,
  ChangeEvent,
  ChartPreferences,
  CrawlRun,
  CrawlSource,
  EditableField,
  EditableFields,
  ObservationOrigin,
  PriceObservation,
  ProductRow,
  ProviderStatus,
  RangeKey,
  RefreshJob,
  Source,
} from '../../types';

export interface CategoryInput {
  name: string;
  keywords: string[];
  enabledSources: CrawlSource[];
  trackedUrls: string[];
}

export type FieldChange = { value: unknown; locked: boolean };
export type OriginFilter = 'all' | ObservationOrigin;

/**
 * 화면이 쓰는 데이터 계약. 실제 운영은 SupabaseRepo(서버 DB 영속, RLS),
 * 설정 전 둘러보기는 DemoRepo(가상 데이터, 이 브라우저에만 저장)를 쓴다.
 */
export interface Repo {
  readonly mode: 'supabase' | 'demo';

  listCategories(includeDeleted?: boolean): Promise<Category[]>;
  createCategory(input: CategoryInput): Promise<Category>;
  updateCategory(id: string, patch: Partial<CategoryInput>): Promise<void>;
  reorderCategories(ids: string[]): Promise<void>;
  deleteCategory(id: string, purgeHistory: boolean): Promise<void>;
  restoreCategory(id: string): Promise<void>;

  /** deletedOnly=true 면 삭제(숨김)된 상품만 — 복구 화면용 */
  listProducts(categoryId: string, deletedOnly?: boolean): Promise<ProductRow[]>;
  addManualProduct(categoryId: string, source: Source, fields: EditableFields): Promise<string>;
  saveProductEdit(productId: string, changes: Partial<Record<EditableField, FieldChange>>, revert: EditableField[]): Promise<void>;
  deleteProduct(productId: string): Promise<void>;
  restoreProduct(productId: string): Promise<void>;

  getSchedule(categoryId: string): Promise<CategorySchedule>;
  saveSchedule(schedule: CategorySchedule): Promise<void>;

  getProductPriceHistory(productId: string, range: RangeKey, originFilter: OriginFilter): Promise<PriceObservation[]>;
  getCategoryPriceComparison(categoryId: string, productIds: string[], range: RangeKey): Promise<Record<string, PriceObservation[]>>;
  listChangeEvents(productId: string, limit?: number): Promise<ChangeEvent[]>;
  getChartPreferences(categoryId: string): Promise<ChartPreferences | null>;
  saveChartPreferences(prefs: ChartPreferences): Promise<void>;

  requestRefresh(categoryId: string | null): Promise<RefreshJob>;
  listRefreshJobs(limit?: number): Promise<RefreshJob[]>;
  listCrawlRuns(limit?: number): Promise<CrawlRun[]>;
  getProviderStatuses(): Promise<ProviderStatus[]>;

  /** 관리자 백업: 테이블별 행 (비밀값 없음) */
  exportBackup(): Promise<Record<string, unknown[]>>;
}

export function rangeStartIso(range: RangeKey, now = Date.now()): string | null {
  const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 } as const;
  return range === 'all' ? null : new Date(now - days[range] * 86_400_000).toISOString();
}
