export type CrawlSource = 'foodspring' | 'naver' | 'coupang';
export type Source = CrawlSource | 'manual';
export type ShippingStatus = 'free' | 'paid' | 'unknown';
export type Availability = 'in_stock' | 'out_of_stock' | 'unknown';
export type ExtractionStatus = 'verified' | 'needs_review' | 'unavailable';
/** 상품 단위 최신 수집 상태. stale = 마지막 수집이 실패해 이전 정상값을 유지 중 */
export type ProductSourceStatus = 'ok' | 'stale' | 'needs_review' | 'manual';
export type PriceKind = 'regular' | 'sale' | 'coupon';
export type JobStatus = 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
export type ObservationOrigin = 'crawl' | 'manual_edit';
export type RangeKey = '7d' | '30d' | '90d' | '1y' | 'all';
export type SortMode = 'unit_asc' | 'unit_desc' | 'best_asc' | 'recent';

/** 제공처 연동 상태 (명세 3.5) */
export type ProviderState = 'available' | 'needs_setup' | 'temporary_error' | 'restricted';

export interface ProviderStatus {
  source: CrawlSource;
  state: ProviderState;
  label: string;
  detail: string;
  lastRunAt: string | null;
  lastRunStatus: JobStatus | null;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  keywords: string[];
  enabledSources: CrawlSource[];
  /** 관리자가 등록한 상품 URL (식봄 상세 페이지 추적) */
  trackedUrls: string[];
  deletedAt: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  lastJobStatus: JobStatus | null;
  lastJobRequestedAt: string | null;
}

export type ScheduleFrequency = 'daily' | 'weekly' | 'interval';

export interface CategorySchedule {
  categoryId: string;
  enabled: boolean;
  timezone: 'Asia/Seoul';
  frequency: ScheduleFrequency;
  /** 0=일 … 6=토 (KST) */
  daysOfWeek: number[];
  /** 'HH:mm' (KST) */
  timesOfDay: string[];
  intervalHours: number | null;
  nextDueAt: string | null;
  lastCompletedSlot: string | null;
}

/** 관리자가 수정할 수 있는(override 가능한) 필드 */
export interface EditableFields {
  title: string;
  seller: string | null;
  productOption: string | null;
  sourceUrl: string;
  rawWeightText: string | null;
  weightKg: number | null;
  regularPriceKrw: number | null;
  salePriceKrw: number | null;
  couponPriceKrw: number | null;
  couponEligible: boolean | null;
  couponConditions: string | null;
  shippingStatus: ShippingStatus;
  shippingPriceKrw: number | null;
  availability: Availability;
}

export type EditableField = keyof EditableFields;

export interface FieldOverride {
  value: unknown;
  isLocked: boolean;
  updatedAt: string;
}

export interface ProductRow {
  id: string;
  categoryId: string;
  source: Source;
  sourceProductId: string | null;
  sourceOptionId: string | null;
  isManual: boolean;
  /** 자동 수집 원본 값 */
  raw: EditableFields;
  /** override가 반영된 최종 값(표에 표시되는 값) */
  effective: EditableFields;
  overrides: Partial<Record<EditableField, FieldOverride>>;
  effectivePriceKrw: number | null;
  effectivePriceKind: PriceKind | null;
  unitPriceKrwPerKg: number | null;
  sourceStatus: ProductSourceStatus;
  extractionStatus: ExtractionStatus;
  reviewNotes: string[];
  lastSuccessAt: string | null;
  observedAt: string | null;
  deletedAt: string | null;
}

export interface PriceSnapshot {
  regularPriceKrw: number | null;
  salePriceKrw: number | null;
  couponPriceKrw: number | null;
  couponEligible: boolean | null;
  weightKg: number | null;
  bestPriceKrw: number | null;
  bestPriceKind: PriceKind | null;
  unitPriceKrwPerKg: number | null;
}

export interface PriceObservation {
  id: string;
  productId: string;
  runId: string | null;
  observedAt: string;
  origin: ObservationOrigin;
  raw: PriceSnapshot;
  effective: PriceSnapshot;
  shippingStatus: ShippingStatus;
  shippingPriceKrw: number | null;
  productOption: string | null;
  availability: Availability;
}

export interface ChangeEvent {
  id: string;
  productId: string;
  observationId: string | null;
  eventType: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export interface RefreshJob {
  id: string;
  categoryId: string | null;
  reason: 'manual_category' | 'manual_all' | 'schedule';
  slotKey: string | null;
  status: JobStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorSummary: string | null;
  attemptCount: number;
  scheduledFor: string | null;
  dispatchStatus: 'pending' | 'sent' | 'failed' | 'not_configured' | 'scheduled';
  dispatchError: string | null;
}

export interface CrawlRun {
  id: string;
  refreshJobId: string | null;
  categoryId: string | null;
  source: CrawlSource;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  collectedCount: number;
  changedCount: number;
  failedCount: number;
  errorDetail: string | null;
}

export interface ChartPreferences {
  categoryId: string;
  selectedProductIds: string[];
  range: RangeKey;
  seriesVisibility: Record<string, boolean>;
  carryForward: boolean;
}
