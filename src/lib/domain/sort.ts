import type { ProductRow, SortMode, UnitBasis } from '../../types';
import { unitOf } from './units';

const SOURCE_ORDER: Record<string, number> = { foodspring: 0, naver: 1, coupang: 2, manual: 3 };

function cmpNullableAsc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // 계산 불가 → 맨 아래
  if (b == null) return -1;
  return a - b;
}

function tieBreak(a: ProductRow, b: ProductRow): number {
  return (
    cmpNullableAsc(a.effectivePriceKrw, b.effectivePriceKrw) ||
    (SOURCE_ORDER[a.source] ?? 9) - (SOURCE_ORDER[b.source] ?? 9) ||
    a.effective.title.localeCompare(b.effective.title, 'ko') ||
    a.id.localeCompare(b.id)
  );
}

/**
 * 명세 5.4: 단가 계산 가능한 상품부터 작은 순, 동률은 최저가·판매처·상품명, 계산 불가 상품은 맨 아래.
 * 어떤 정렬 모드에서도 단가 null 행은 항상 아래에 둔다.
 */
export function sortProducts(rows: ProductRow[], mode: SortMode, basis: UnitBasis = 'kg'): ProductRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    const ua = unitOf(a, basis);
    const ub = unitOf(b, basis);
    switch (mode) {
      case 'unit_asc':
        return cmpNullableAsc(ua, ub) || tieBreak(a, b);
      case 'unit_desc': {
        if (ua == null || ub == null) return cmpNullableAsc(ua, ub) || tieBreak(a, b);
        return ub - ua || tieBreak(a, b);
      }
      case 'best_asc':
        return cmpNullableAsc(a.effectivePriceKrw, b.effectivePriceKrw) || cmpNullableAsc(ua, ub) || tieBreak(a, b);
      case 'recent': {
        const ta = a.lastSuccessAt ? Date.parse(a.lastSuccessAt) : null;
        const tb = b.lastSuccessAt ? Date.parse(b.lastSuccessAt) : null;
        if (ta == null || tb == null) return cmpNullableAsc(ta, tb) || tieBreak(a, b);
        return tb - ta || cmpNullableAsc(ua, ub) || tieBreak(a, b);
      }
    }
  });
  return copy;
}

export const SORT_LABEL: Record<SortMode, string> = {
  unit_asc: '단가 낮은 순',
  unit_desc: '단가 높은 순',
  best_asc: '상품가 낮은 순',
  recent: '최근 갱신 순',
};
