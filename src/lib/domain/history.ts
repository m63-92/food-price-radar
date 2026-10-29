import type { PriceObservation, PriceSnapshot, RangeKey, UnitBasis } from '../../types';
import { kstDayKey } from './format';

/**
 * 가격 이력/그래프 집계 (명세 8.1~8.4). crawler/analytics.py 와 같은 규칙.
 *  - 관측하지 않은 시점의 값을 만들지 않는다 (보간 금지).
 *  - null 은 결측이며 0원으로 바꾸지 않는다.
 *  - 원/kg 은 관측 당시 중량으로 계산된 값을 그대로 쓴다 (소급 재계산 금지).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<Exclude<RangeKey, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

export const RANGE_LABEL: Record<RangeKey, string> = {
  '7d': '7일',
  '30d': '30일',
  '90d': '90일',
  '1y': '1년',
  all: '전체',
};

export function rangeStart(range: RangeKey, now: number): number | null {
  return range === 'all' ? null : now - RANGE_DAYS[range] * DAY_MS;
}

export function compareObservations(a: PriceObservation, b: PriceObservation): number {
  return Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.id.localeCompare(b.id);
}

export function filterRange(obs: PriceObservation[], range: RangeKey, now: number): PriceObservation[] {
  const start = rangeStart(range, now);
  return obs
    .filter((o) => start == null || Date.parse(o.observedAt) >= start)
    .sort(compareObservations);
}

export type SnapshotMode = 'effective' | 'raw';
export type SeriesKey = 'regular' | 'sale' | 'coupon' | 'best' | 'unit';

export const SERIES_LABEL: Record<SeriesKey, string> = {
  regular: '정상가',
  sale: '할인가',
  coupon: '쿠폰가',
  best: '최저 유효 상품가',
  unit: '단가',
};

export function snapUnit(snap: PriceSnapshot, basis: UnitBasis): number | null {
  return basis === 'piece' ? snap.unitPriceKrwPerPiece : snap.unitPriceKrwPerKg;
}

export function seriesValue(snap: PriceSnapshot, key: SeriesKey, basis: UnitBasis = 'kg'): number | null {
  switch (key) {
    case 'regular':
      return snap.regularPriceKrw;
    case 'sale':
      return snap.salePriceKrw;
    case 'coupon':
      return snap.couponPriceKrw;
    case 'best':
      return snap.bestPriceKrw;
    case 'unit':
      return snapUnit(snap, basis);
  }
}

export interface ChangeSummary {
  first: number | null;
  firstAt: string | null;
  last: number | null;
  lastAt: string | null;
  min: number | null;
  max: number | null;
  delta: number | null;
  /** (마지막 유효 값 - 첫 유효 값) / 첫 유효 값 * 100. 첫 값이 없거나 0 이면 null */
  pct: number | null;
  count: number;
}

export function summarize(points: Array<{ at: string; value: number | null }>): ChangeSummary {
  const valid = points.filter((p): p is { at: string; value: number } => p.value != null && Number.isFinite(p.value));
  if (valid.length === 0) {
    return { first: null, firstAt: null, last: null, lastAt: null, min: null, max: null, delta: null, pct: null, count: 0 };
  }
  const first = valid[0];
  const last = valid[valid.length - 1];
  const values = valid.map((p) => p.value);
  const delta = last.value - first.value;
  return {
    first: first.value,
    firstAt: first.at,
    last: last.value,
    lastAt: last.at,
    min: Math.min(...values),
    max: Math.max(...values),
    delta,
    pct: first.value === 0 ? null : (delta / first.value) * 100,
    count: valid.length,
  };
}

/** getPriceChangeSummary: 상품가와 원/kg 요약을 분리해서 반환 */
export function getPriceChangeSummary(
  obs: PriceObservation[],
  range: RangeKey,
  now: number,
  mode: SnapshotMode = 'effective',
  basis: UnitBasis = 'kg',
): { price: ChangeSummary; unit: ChangeSummary } {
  const inRange = filterRange(obs, range, now);
  return {
    price: summarize(inRange.map((o) => ({ at: o.observedAt, value: o[mode].bestPriceKrw }))),
    unit: summarize(inRange.map((o) => ({ at: o.observedAt, value: snapUnit(o[mode], basis) }))),
  };
}

export interface HistoryPoint {
  t: number;
  observation: PriceObservation;
  regular: number | null;
  sale: number | null;
  coupon: number | null;
  best: number | null;
  unit: number | null;
  /** 직전 관측 대비 최저가 변동 (원). 변동 없으면 0, 직전 값이 없으면 null */
  bestDelta: number | null;
  unitDelta: number | null;
}

export function buildHistoryPoints(obs: PriceObservation[], mode: SnapshotMode, basis: UnitBasis = 'kg'): HistoryPoint[] {
  const sorted = [...obs].sort(compareObservations);
  let prevBest: number | null = null;
  let prevUnit: number | null = null;
  return sorted.map((o) => {
    const snap = o[mode];
    const best = snap.bestPriceKrw;
    const unit = snapUnit(snap, basis);
    const point: HistoryPoint = {
      t: Date.parse(o.observedAt),
      observation: o,
      regular: snap.regularPriceKrw,
      sale: snap.salePriceKrw,
      coupon: snap.couponPriceKrw,
      best,
      unit,
      bestDelta: best != null && prevBest != null ? best - prevBest : null,
      unitDelta: unit != null && prevUnit != null ? unit - prevUnit : null,
    };
    if (best != null) prevBest = best;
    if (unit != null) prevUnit = unit;
    return point;
  });
}

/**
 * 일별 대표값: KST 날짜별 그날 마지막 성공 관측의 원/kg. 관측이 없는 날은 키가 없다.
 */
export function dailyRepresentative(obs: PriceObservation[], mode: SnapshotMode = 'effective', basis: UnitBasis = 'kg'): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const o of [...obs].sort(compareObservations)) {
    out.set(kstDayKey(o.observedAt), snapUnit(o[mode], basis));
  }
  return out;
}

export function kstDaysBetween(startDay: string, endDay: string): string[] {
  const days: string[] = [];
  let t = Date.parse(`${startDay}T00:00:00Z`);
  const end = Date.parse(`${endDay}T00:00:00Z`);
  while (t <= end) {
    days.push(new Date(t).toISOString().slice(0, 10));
    t += DAY_MS;
  }
  return days;
}

export interface ComparisonRow {
  day: string;
  /** productId → 그날 마지막 관측 원/kg (없으면 null) */
  values: Record<string, number | null>;
  /** productId → 마지막 확인가 유지(추정) 값. 실제 관측이 있는 날도 선 연결을 위해 채운다 */
  estimated: Record<string, number | null>;
}

/**
 * getCategoryPriceComparison 의 집계부. 선택 상품별 일별 대표값을 같은 날짜 축에 올린다.
 * 축은 기간 내 첫 관측일 ~ 오늘(KST)의 모든 날짜이며, 관측이 없는 날은 null(선 끊김).
 */
export function buildComparison(
  obsByProduct: Record<string, PriceObservation[]>,
  range: RangeKey,
  now: number,
  mode: SnapshotMode = 'effective',
  basis: UnitBasis = 'kg',
): { rows: ComparisonRow[]; insufficient: string[] } {
  const daily: Record<string, Map<string, number | null>> = {};
  const insufficient: string[] = [];
  let minDay: string | null = null;
  for (const [pid, obs] of Object.entries(obsByProduct)) {
    const inRange = filterRange(obs, range, now);
    const rep = dailyRepresentative(inRange, mode, basis);
    daily[pid] = rep;
    const hasValue = [...rep.values()].some((v) => v != null);
    if (!hasValue) insufficient.push(pid);
    for (const d of rep.keys()) if (minDay == null || d < minDay) minDay = d;
  }
  if (minDay == null) return { rows: [], insufficient };
  const today = kstDayKey(now);
  const days = kstDaysBetween(minDay, today > minDay ? today : minDay);
  const lastKnown: Record<string, number | null> = {};
  const rows = days.map((day) => {
    const values: Record<string, number | null> = {};
    const estimated: Record<string, number | null> = {};
    for (const pid of Object.keys(daily)) {
      const rep = daily[pid];
      const v = rep.has(day) ? (rep.get(day) ?? null) : null;
      values[pid] = v;
      if (v != null) lastKnown[pid] = v;
      estimated[pid] = lastKnown[pid] ?? null;
    }
    return { day, values, estimated };
  });
  return { rows, insufficient };
}

/** 현재 최저 단가 상위 N개 (기본 비교 대상) */
export function defaultComparisonSelection(
  rows: Array<{ id: string; unitPriceKrwPerKg: number | null }>,
  n = 5,
): string[] {
  return rows
    .filter((r) => r.unitPriceKrwPerKg != null)
    .sort((a, b) => (a.unitPriceKrwPerKg as number) - (b.unitPriceKrwPerKg as number))
    .slice(0, n)
    .map((r) => r.id);
}

/**
 * 시각화용 다운샘플링: 포인트가 많으면 버킷마다 첫/최소/최대/마지막 관측만 남겨
 * 극값과 변동 지점을 보존한다. 원본은 DB 에 그대로 유지된다.
 */
export function downsample<T extends { t: number; best: number | null; unit: number | null }>(points: T[], maxPoints = 1500): T[] {
  if (points.length <= maxPoints) return points;
  const buckets = Math.ceil(maxPoints / 4);
  const size = Math.ceil(points.length / buckets);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += size) {
    const chunk = points.slice(i, i + size);
    const keep = new Set<T>([chunk[0], chunk[chunk.length - 1]]);
    const valued = chunk.filter((p) => p.unit != null);
    if (valued.length) {
      keep.add(valued.reduce((a, b) => ((a.unit as number) <= (b.unit as number) ? a : b)));
      keep.add(valued.reduce((a, b) => ((a.unit as number) >= (b.unit as number) ? a : b)));
    }
    out.push(...chunk.filter((p) => keep.has(p)));
  }
  return out;
}
