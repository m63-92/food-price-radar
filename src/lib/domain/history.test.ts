import { describe, expect, it } from 'vitest';
import type { PriceObservation } from '../../types';
import { buildComparison, buildHistoryPoints, dailyRepresentative, defaultComparisonSelection, getPriceChangeSummary } from './history';
import { computeBestPrice, computeUnitPrice } from './pricing';

/** 명세 8.4 수용 기준 — 계산 검증용 가상 데이터 */
function obs(
  id: string,
  productId: string,
  kstDate: string,
  regular: number | null,
  sale: number | null,
  coupon: number | null,
  weightKg: number | null,
): PriceObservation {
  const couponEligible = coupon != null ? true : null;
  const best = computeBestPrice({ regularPriceKrw: regular, salePriceKrw: sale, couponPriceKrw: coupon, couponEligible });
  const snap = {
    regularPriceKrw: regular,
    salePriceKrw: sale,
    couponPriceKrw: coupon,
    couponEligible,
    weightKg,
    bestPriceKrw: best.bestPriceKrw,
    bestPriceKind: best.kind,
    unitPriceKrwPerKg: computeUnitPrice(best.bestPriceKrw, weightKg),
  };
  return {
    id,
    productId,
    runId: null,
    observedAt: new Date(Date.parse(`${kstDate}T09:00:00+09:00`)).toISOString(),
    origin: 'crawl',
    raw: snap,
    effective: snap,
    shippingStatus: 'unknown',
    shippingPriceKrw: null,
    productOption: null,
    availability: 'in_stock',
  };
}

const A = [
  obs('a1', 'A', '2026-10-01', 12000, 10000, null, 1),
  obs('a2', 'A', '2026-10-05', 12000, 9000, null, 1),
  obs('a3', 'A', '2026-10-10', 12000, 9000, 8000, 1),
];
const B = [obs('b1', 'B', '2026-10-10', 6000, 5500, null, 0.5)];
const NOW = Date.parse('2026-10-11T12:00:00+09:00');

describe('가격 이력 집계 (명세 8.4)', () => {
  it('마늘 A 10/01→10/10 단가 등락률 -20%, 하락액 -2,000원/kg', () => {
    const s = getPriceChangeSummary(A, '30d', NOW);
    expect(s.unit.first).toBe(10000);
    expect(s.unit.last).toBe(8000);
    expect(s.unit.delta).toBe(-2000);
    expect(s.unit.pct).toBe(-20);
    expect(s.unit.min).toBe(8000);
    expect(s.unit.max).toBe(10000);
    expect(s.price.first).toBe(10000);
  });

  it('비교 그래프 10/10 값 A=8,000, B=11,000; 10/02~10/04 와 10/11 은 null', () => {
    const { rows, insufficient } = buildComparison({ A, B }, '30d', NOW);
    const byDay = Object.fromEntries(rows.map((r) => [r.day, r.values]));
    expect(byDay['2026-10-10']).toEqual({ A: 8000, B: 11000 });
    for (const d of ['2026-10-02', '2026-10-03', '2026-10-04']) expect(byDay[d].A).toBeNull();
    expect(byDay['2026-10-11'].A).toBeNull();
    expect(byDay['2026-10-11'].B).toBeNull();
    expect(insufficient).toEqual([]);
    expect(rows.flatMap((r) => Object.values(r.values)).includes(0)).toBe(false);
  });

  it('추정 유지 옵션은 별도 값으로만 제공', () => {
    const { rows } = buildComparison({ A }, '30d', NOW);
    const r = rows.find((x) => x.day === '2026-10-03')!;
    expect(r.values.A).toBeNull();
    expect(r.estimated.A).toBe(10000);
  });

  it('일별 대표값은 그날 마지막 관측', () => {
    const later = { ...obs('x2', 'X', '2026-10-10', 8500, null, null, 1), observedAt: '2026-10-10T10:00:00Z' };
    const same = [obs('x1', 'X', '2026-10-10', 9000, null, null, 1), later];
    expect(dailyRepresentative(same).get('2026-10-10')).toBe(8500);
  });

  it('관측 당시 중량으로 단가 유지 (소급 재계산 금지)', () => {
    const w = [obs('w1', 'W', '2026-10-01', 10000, null, null, 1), obs('w2', 'W', '2026-10-02', 10000, null, null, 2)];
    expect(buildHistoryPoints(w, 'effective').map((p) => p.unit)).toEqual([10000, 5000]);
  });

  it('첫 값이 0 이거나 없으면 변동률은 null', () => {
    const z = [obs('z1', 'Z', '2026-10-01', 0, null, null, 1), obs('z2', 'Z', '2026-10-02', 100, null, null, 1)];
    expect(getPriceChangeSummary(z, 'all', NOW).price.pct).toBeNull();
    expect(getPriceChangeSummary([], 'all', NOW).price.pct).toBeNull();
  });

  it('관측 없는 상품은 데이터 부족', () => {
    expect(buildComparison({ A, C: [] }, '30d', NOW).insufficient).toEqual(['C']);
  });

  it('기간 필터: 10/11 기준 7일이면 10/01 관측 제외', () => {
    const s = getPriceChangeSummary(A, '7d', NOW);
    expect(s.unit.first).toBe(9000);
    expect(s.unit.count).toBe(2);
    expect(s.unit.pct).toBeCloseTo(-11.111, 2);
  });

  it('변동 지점 표시용 delta', () => {
    expect(buildHistoryPoints(A, 'effective').map((p) => p.bestDelta)).toEqual([null, -1000, -1000]);
  });

  it('기본 비교 대상은 단가 상위 5개', () => {
    const rows = [1, 2, 3, 4, 5, 6, null].map((u, i) => ({ id: `p${i}`, unitPriceKrwPerKg: u }));
    expect(defaultComparisonSelection(rows)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });
});
