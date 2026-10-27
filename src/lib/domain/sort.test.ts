import { describe, expect, it } from 'vitest';
import type { ProductRow } from '../../types';
import { sortProducts } from './sort';

function row(id: string, unit: number | null, best: number | null, title = id, lastSuccessAt: string | null = null): ProductRow {
  const f = {
    title,
    seller: null,
    productOption: null,
    sourceUrl: 'https://example.invalid',
    rawWeightText: null,
    weightKg: null,
    regularPriceKrw: best,
    salePriceKrw: null,
    couponPriceKrw: null,
    couponEligible: null,
    couponConditions: null,
    shippingStatus: 'unknown' as const,
    shippingPriceKrw: null,
    availability: 'unknown' as const,
  };
  return {
    id,
    categoryId: 'c',
    source: 'manual',
    sourceProductId: null,
    sourceOptionId: null,
    isManual: true,
    raw: f,
    effective: f,
    overrides: {},
    effectivePriceKrw: best,
    effectivePriceKind: best == null ? null : 'regular',
    unitPriceKrwPerKg: unit,
    sourceStatus: 'manual',
    extractionStatus: 'verified',
    reviewNotes: [],
    lastSuccessAt,
    observedAt: null,
    deletedAt: null,
  };
}

describe('정렬 (명세 5.4)', () => {
  const rows = [row('C', null, 3900, '마늘 C'), row('B', 9000, 4500, '마늘 B'), row('A', 7000, 7000, '마늘 A'), row('D', null, null, '마늘 D')];
  it('기본: 원/kg 오름차순, 계산 불가는 맨 아래', () => {
    expect(sortProducts(rows, 'unit_asc').map((r) => r.id)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('높은 순에서도 계산 불가는 맨 아래', () => {
    expect(sortProducts(rows, 'unit_desc').map((r) => r.id)).toEqual(['B', 'A', 'C', 'D']);
  });
  it('동일 단가면 상품 최저가 → 판매처 → 상품명', () => {
    const t = [row('x', 5000, 10000, '나'), row('y', 5000, 5000, '다'), row('z', 5000, 5000, '가')];
    expect(sortProducts(t, 'unit_asc').map((r) => r.id)).toEqual(['z', 'y', 'x']);
  });
  it('최근 갱신 순', () => {
    const t = [row('old', 1, 1, 'o', '2026-10-01T00:00:00Z'), row('new', 2, 2, 'n', '2026-10-20T00:00:00Z'), row('none', 3, 3)];
    expect(sortProducts(t, 'recent').map((r) => r.id)).toEqual(['new', 'old', 'none']);
  });
});
