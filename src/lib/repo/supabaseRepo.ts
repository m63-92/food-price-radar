import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Availability,
  Category,
  CategorySchedule,
  ChangeEvent,
  ChartPreferences,
  CrawlRun,
  EditableField,
  EditableFields,
  FieldOverride,
  PriceKind,
  PriceObservation,
  ProductRow,
  ProviderStatus,
  RangeKey,
  RefreshJob,
  ShippingStatus,
  Source,
} from '../../types';
import { EDITABLE_FIELDS, FIELD_DB_NAME } from '../domain/effective';
import { rangeStartIso, type CategoryInput, type FieldChange, type OriginFilter, type Repo } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const DB_TO_FIELD = Object.fromEntries(Object.entries(FIELD_DB_NAME).map(([k, v]) => [v, k])) as Record<string, EditableField>;
const PAGE = 1000;

function mapCategory(r: Row): Category {
  return {
    id: r.id,
    name: r.name,
    sortOrder: r.sort_order,
    keywords: r.keywords ?? [],
    enabledSources: r.enabled_sources ?? [],
    trackedUrls: r.tracked_urls ?? [],
    excludeKeywords: r.exclude_keywords ?? [],
    unitBasis: r.unit_basis ?? 'kg',
    pieceLabel: r.piece_label ?? '개',
    showPieceCount: r.show_piece_count ?? false,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    lastSuccessAt: r.last_success_at ?? null,
    lastJobStatus: r.last_job_status ?? null,
    lastJobRequestedAt: r.last_job_requested_at ?? null,
  };
}

function mapProduct(r: Row): ProductRow {
  const m = r.raw_meta ?? {};
  const raw: EditableFields = {
    title: m.title ?? r.title,
    seller: m.seller ?? null,
    productOption: m.product_option ?? null,
    sourceUrl: m.source_url ?? r.source_url,
    rawWeightText: m.raw_weight_text ?? null,
    weightKg: num(m.weight_kg),
    pieceCount: num(m.piece_count),
    regularPriceKrw: r.raw_regular_price_krw,
    salePriceKrw: r.raw_sale_price_krw,
    couponPriceKrw: r.raw_coupon_price_krw,
    couponEligible: r.raw_coupon_eligible,
    couponConditions: r.raw_coupon_conditions,
    shippingStatus: (r.raw_shipping_status ?? 'unknown') as ShippingStatus,
    shippingPriceKrw: r.raw_shipping_price_krw,
    availability: (m.availability ?? 'unknown') as Availability,
  };
  const effective: EditableFields = {
    title: r.title,
    seller: r.seller,
    productOption: r.product_option,
    sourceUrl: r.source_url,
    rawWeightText: r.raw_weight_text,
    weightKg: num(r.weight_kg),
    pieceCount: num(r.piece_count),
    regularPriceKrw: r.regular_price_krw,
    salePriceKrw: r.sale_price_krw,
    couponPriceKrw: r.coupon_price_krw,
    couponEligible: r.coupon_eligible,
    couponConditions: r.coupon_conditions,
    shippingStatus: (r.shipping_status ?? 'unknown') as ShippingStatus,
    shippingPriceKrw: r.shipping_price_krw,
    availability: (r.availability ?? 'unknown') as Availability,
  };
  const overrides: Partial<Record<EditableField, FieldOverride>> = {};
  for (const [dbName, o] of Object.entries((r.overrides ?? {}) as Record<string, Row>)) {
    const f = DB_TO_FIELD[dbName];
    if (f) overrides[f] = { value: o.value, isLocked: o.is_locked, updatedAt: o.updated_at };
  }
  return {
    id: r.id,
    categoryId: r.category_id,
    source: r.source,
    sourceProductId: r.source_product_id,
    sourceOptionId: r.source_option_id,
    isManual: r.is_manual,
    raw,
    effective,
    overrides,
    effectivePriceKrw: r.effective_price_krw,
    effectivePriceKind: r.effective_price_kind as PriceKind | null,
    unitPriceKrwPerKg: num(r.unit_price_krw_per_kg),
    unitPriceKrwPerPiece: num(r.unit_price_krw_per_piece),
    pieceLabel: r.piece_label ?? null,
    orderStatus: r.order_status ?? 'unknown',
    orderStatusReason: r.order_status_reason ?? null,
    orderCutoff: r.order_cutoff ?? null,
    deliveryLeadDays: r.delivery_lead_days ?? null,
    deliveryNote: r.delivery_note ?? null,
    shippingFreeThresholdKrw: r.shipping_free_threshold_krw ?? null,
    sourceStatus: r.source_status,
    extractionStatus: r.extraction_status,
    reviewNotes: r.review_notes ?? [],
    lastSuccessAt: r.last_success_at,
    observedAt: r.observed_at,
    deletedAt: r.deleted_at,
  };
}

function mapObservation(r: Row): PriceObservation {
  return {
    id: r.id,
    productId: r.product_id,
    runId: r.run_id,
    observedAt: r.observed_at,
    origin: r.origin,
    raw: {
      regularPriceKrw: r.raw_regular_price_krw,
      salePriceKrw: r.raw_sale_price_krw,
      couponPriceKrw: r.raw_coupon_price_krw,
      couponEligible: r.raw_coupon_eligible,
      weightKg: num(r.raw_weight_kg),
      pieceCount: num(r.raw_piece_count),
      bestPriceKrw: r.raw_best_price_krw,
      bestPriceKind: r.raw_best_price_kind,
      unitPriceKrwPerKg: num(r.raw_unit_price_krw_per_kg),
      unitPriceKrwPerPiece: num(r.raw_unit_price_krw_per_piece),
    },
    effective: {
      regularPriceKrw: r.regular_price_krw,
      salePriceKrw: r.sale_price_krw,
      couponPriceKrw: r.coupon_price_krw,
      couponEligible: r.coupon_eligible,
      weightKg: num(r.effective_weight_kg),
      pieceCount: num(r.effective_piece_count),
      bestPriceKrw: r.effective_best_price_krw,
      bestPriceKind: r.effective_best_price_kind,
      unitPriceKrwPerKg: num(r.effective_unit_price_krw_per_kg),
      unitPriceKrwPerPiece: num(r.effective_unit_price_krw_per_piece),
    },
    shippingStatus: r.shipping_status,
    shippingPriceKrw: r.shipping_price_krw,
    productOption: r.product_option,
    availability: r.availability,
  };
}

function mapJob(r: Row): RefreshJob {
  return {
    id: r.id,
    categoryId: r.category_id,
    reason: r.reason,
    slotKey: r.slot_key,
    status: r.status,
    requestedAt: r.requested_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    errorSummary: r.error_summary,
    attemptCount: r.attempt_count,
    scheduledFor: r.scheduled_for,
    dispatchStatus: r.dispatch_status,
    dispatchError: r.dispatch_error,
  };
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function toDbValues(fields: Partial<EditableFields>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of EDITABLE_FIELDS) if (f in fields) out[FIELD_DB_NAME[f]] = fields[f] ?? null;
  return out;
}

export class SupabaseRepo implements Repo {
  readonly mode = 'supabase' as const;
  constructor(private sb: SupabaseClient) {}

  async listCategories(includeDeleted = false) {
    let q = this.sb.from('category_overview').select('*').order('sort_order').order('created_at');
    if (!includeDeleted) q = q.is('deleted_at', null);
    return (check(await q) as Row[]).map(mapCategory);
  }

  async createCategory(input: CategoryInput) {
    const { data: u } = await this.sb.auth.getUser();
    const existing = await this.listCategories(false);
    const row = check(
      await this.sb
        .from('categories')
        .insert({
          owner_id: u.user?.id,
          name: input.name.trim(),
          keywords: input.keywords,
          enabled_sources: input.enabledSources,
          tracked_urls: input.trackedUrls,
          exclude_keywords: input.excludeKeywords,
          unit_basis: input.unitBasis,
          piece_label: input.pieceLabel,
          show_piece_count: input.showPieceCount,
          sort_order: existing.length + 1,
        })
        .select()
        .single(),
    );
    return mapCategory(row as Row);
  }

  async updateCategory(id: string, patch: Partial<CategoryInput>) {
    const body: Row = {};
    if (patch.name !== undefined) body.name = patch.name.trim();
    if (patch.keywords) body.keywords = patch.keywords;
    if (patch.enabledSources) body.enabled_sources = patch.enabledSources;
    if (patch.trackedUrls) body.tracked_urls = patch.trackedUrls;
    if (patch.excludeKeywords) body.exclude_keywords = patch.excludeKeywords;
    if (patch.unitBasis) body.unit_basis = patch.unitBasis;
    if (patch.pieceLabel) body.piece_label = patch.pieceLabel;
    if (patch.showPieceCount !== undefined) body.show_piece_count = patch.showPieceCount;
    check(await this.sb.from('categories').update(body).eq('id', id));
  }

  async reorderCategories(ids: string[]) {
    check(await this.sb.rpc('fpr_reorder_categories', { p_ids: ids }));
  }
  async deleteCategory(id: string, purgeHistory: boolean) {
    check(await this.sb.rpc('fpr_delete_category', { p_category_id: id, p_purge_history: purgeHistory }));
  }
  async restoreCategory(id: string) {
    check(await this.sb.rpc('fpr_restore_category', { p_category_id: id }));
  }

  async listProducts(categoryId: string, deletedOnly = false) {
    let q = this.sb.from('product_rows').select('*').eq('category_id', categoryId);
    q = deletedOnly ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
    return (check(await q) as Row[]).map(mapProduct);
  }

  async addManualProduct(categoryId: string, source: Source, fields: EditableFields) {
    return check(
      await this.sb.rpc('fpr_add_manual_product', { p_category_id: categoryId, p_source: source, p_values: toDbValues(fields) }),
    ) as string;
  }

  async saveProductEdit(productId: string, changes: Partial<Record<EditableField, FieldChange>>, revert: EditableField[]) {
    const p_changes: Row = {};
    for (const [f, c] of Object.entries(changes) as Array<[EditableField, FieldChange]>) {
      p_changes[FIELD_DB_NAME[f]] = { value: c.value ?? null, locked: c.locked };
    }
    check(
      await this.sb.rpc('fpr_save_product_edit', {
        p_product_id: productId,
        p_changes,
        p_revert: revert.map((f) => FIELD_DB_NAME[f]),
      }),
    );
  }

  async deleteProduct(id: string) {
    check(await this.sb.rpc('fpr_delete_product', { p_product_id: id }));
  }
  async restoreProduct(id: string) {
    check(await this.sb.rpc('fpr_restore_product', { p_product_id: id }));
  }

  async getSchedule(categoryId: string): Promise<CategorySchedule> {
    const r = check(await this.sb.from('category_schedules').select('*').eq('category_id', categoryId).single()) as Row;
    return {
      categoryId,
      enabled: r.enabled,
      timezone: 'Asia/Seoul',
      frequency: r.frequency,
      daysOfWeek: r.days_of_week ?? [],
      timesOfDay: r.times_of_day ?? [],
      intervalHours: r.interval_hours,
      nextDueAt: r.next_due_at,
      lastCompletedSlot: r.last_completed_slot,
    };
  }

  async saveSchedule(s: CategorySchedule) {
    check(
      await this.sb
        .from('category_schedules')
        .update({
          enabled: s.enabled,
          frequency: s.frequency,
          days_of_week: s.daysOfWeek,
          times_of_day: s.timesOfDay,
          interval_hours: s.frequency === 'interval' ? s.intervalHours : null,
          next_due_at: s.nextDueAt,
        })
        .eq('category_id', s.categoryId),
    );
  }

  private async pagedObservations(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = check(await build(from, from + PAGE - 1)) as Row[];
      out.push(...rows);
      if (rows.length < PAGE || out.length >= 20_000) break;
    }
    return out.map(mapObservation);
  }

  async getProductPriceHistory(productId: string, range: RangeKey, originFilter: OriginFilter) {
    const start = rangeStartIso(range);
    return this.pagedObservations((from, to) => {
      let q = this.sb.from('price_observations').select('*').eq('product_id', productId);
      if (start) q = q.gte('observed_at', start);
      if (originFilter !== 'all') q = q.eq('origin', originFilter);
      return q.order('observed_at').order('id').range(from, to);
    });
  }

  async getCategoryPriceComparison(categoryId: string, productIds: string[], range: RangeKey) {
    if (productIds.length === 0) return {};
    const start = rangeStartIso(range);
    const obs = await this.pagedObservations((from, to) => {
      let q = this.sb
        .from('price_observations')
        .select('*')
        .eq('category_id', categoryId)
        .in('product_id', productIds);
      if (start) q = q.gte('observed_at', start);
      return q.order('observed_at').order('id').range(from, to);
    });
    const out: Record<string, PriceObservation[]> = Object.fromEntries(productIds.map((id) => [id, []]));
    for (const o of obs) out[o.productId]?.push(o);
    return out;
  }

  async listChangeEvents(productId: string, limit = 50): Promise<ChangeEvent[]> {
    const rows = check(
      await this.sb.from('change_events').select('*').eq('product_id', productId).order('created_at', { ascending: false }).limit(limit),
    ) as Row[];
    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      observationId: r.observation_id,
      eventType: r.event_type,
      oldValue: r.old_value,
      newValue: r.new_value,
      createdAt: r.created_at,
    }));
  }

  async getChartPreferences(categoryId: string): Promise<ChartPreferences | null> {
    const r = check(await this.sb.from('category_chart_preferences').select('*').eq('category_id', categoryId).maybeSingle()) as Row | null;
    if (!r) return null;
    return {
      categoryId,
      selectedProductIds: r.selected_product_ids ?? [],
      range: r.range,
      seriesVisibility: r.series_visibility ?? {},
      carryForward: r.carry_forward,
    };
  }

  async saveChartPreferences(p: ChartPreferences) {
    const { data: u } = await this.sb.auth.getUser();
    check(
      await this.sb.from('category_chart_preferences').upsert({
        owner_id: u.user?.id,
        category_id: p.categoryId,
        selected_product_ids: p.selectedProductIds.slice(0, 10),
        range: p.range,
        series_visibility: p.seriesVisibility,
        carry_forward: p.carryForward,
      }),
    );
  }

  async requestRefresh(categoryId: string | null): Promise<RefreshJob> {
    // Edge Function 이 권한 확인 → 큐 생성 → GitHub workflow_dispatch. 함수 미배포 시 큐만 생성.
    const res = await this.sb.functions.invoke('request-refresh', { body: { categoryId } });
    if (!res.error && res.data?.job) return mapJob(res.data.job);
    const job = check(await this.sb.rpc('fpr_enqueue_refresh', { p_category_id: categoryId })) as Row;
    return { ...mapJob(job), dispatchStatus: 'not_configured', dispatchError: 'Edge Function 호출 실패: 다음 정기 실행(최대 약 5분+)에서 처리' };
  }

  async listRefreshJobs(limit = 50) {
    return (check(await this.sb.from('refresh_jobs').select('*').order('requested_at', { ascending: false }).limit(limit)) as Row[]).map(mapJob);
  }

  async listCrawlRuns(limit = 50): Promise<CrawlRun[]> {
    const rows = check(await this.sb.from('crawl_runs').select('*').order('started_at', { ascending: false }).limit(limit)) as Row[];
    return rows.map((r) => ({
      id: r.id,
      refreshJobId: r.refresh_job_id,
      categoryId: r.category_id,
      source: r.source,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      collectedCount: r.collected_count,
      changedCount: r.changed_count,
      failedCount: r.failed_count,
      errorDetail: r.error_detail,
    }));
  }

  async getProviderStatuses(): Promise<ProviderStatus[]> {
    const rows = check(await this.sb.from('provider_status').select('*')) as Row[];
    const runs = await this.listCrawlRuns(100);
    return rows.map((r) => {
      const last = runs.find((x) => x.source === r.source);
      return {
        source: r.source,
        state: r.state,
        label: r.source,
        detail: r.detail,
        lastRunAt: last?.startedAt ?? null,
        lastRunStatus: last?.status ?? null,
      };
    });
  }

  async exportBackup() {
    const tables = [
      'categories',
      'category_schedules',
      'products',
      'current_prices',
      'product_overrides',
      'price_observations',
      'change_events',
      'refresh_jobs',
      'crawl_runs',
      'audit_logs',
      'deleted_source_keys',
      'category_chart_preferences',
    ];
    const out: Record<string, unknown[]> = {};
    for (const t of tables) {
      const rows: unknown[] = [];
      for (let from = 0; ; from += PAGE) {
        const page = check(await this.sb.from(t).select('*').range(from, from + PAGE - 1)) as unknown[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      out[t] = rows;
    }
    return out;
  }
}
