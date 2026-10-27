import type { PriceKind } from '../../types';

/**
 * 최저 유효 상품가 선택 (명세 5.2 — 변경 금지 규칙)
 *  - 정상가·할인가·쿠폰가 중 실제 적용 가능한 가격의 최솟값
 *  - 쿠폰가는 couponEligible === true 로 검증된 경우에만 포함
 *  - 배송비·최소구매금액·결제수수료는 절대 더하지 않는다 (입력으로도 받지 않음)
 * SQL(fpr_best_price)·Python(normalize.best_price)과 동일한 결과를 내야 한다.
 */
export interface PriceInputs {
  regularPriceKrw: number | null;
  salePriceKrw: number | null;
  couponPriceKrw: number | null;
  couponEligible: boolean | null;
}

export type PriceWarning = 'coupon_excluded' | 'sale_gt_regular';

export interface BestPriceResult {
  bestPriceKrw: number | null;
  kind: PriceKind | null;
  warnings: PriceWarning[];
}

const isValid = (p: number | null | undefined): p is number =>
  p != null && Number.isFinite(p) && p >= 0;

export function computeBestPrice(input: PriceInputs): BestPriceResult {
  const warnings: PriceWarning[] = [];
  // 동률이면 정상가 → 할인가 → 쿠폰가 순으로 표기
  const candidates: Array<[PriceKind, number]> = [];
  if (isValid(input.regularPriceKrw)) candidates.push(['regular', input.regularPriceKrw]);
  if (isValid(input.salePriceKrw)) candidates.push(['sale', input.salePriceKrw]);
  if (isValid(input.couponPriceKrw)) {
    if (input.couponEligible === true) candidates.push(['coupon', input.couponPriceKrw]);
    else warnings.push('coupon_excluded');
  }
  if (
    isValid(input.regularPriceKrw) &&
    isValid(input.salePriceKrw) &&
    input.salePriceKrw > input.regularPriceKrw
  ) {
    warnings.push('sale_gt_regular');
  }
  if (candidates.length === 0) return { bestPriceKrw: null, kind: null, warnings };
  let best = candidates[0];
  for (const c of candidates) if (c[1] < best[1]) best = c;
  return { bestPriceKrw: best[1], kind: best[0], warnings };
}

export function computeUnitPrice(bestPriceKrw: number | null, weightKg: number | null): number | null {
  if (bestPriceKrw == null || weightKg == null || !(weightKg > 0)) return null;
  return Math.round((bestPriceKrw / weightKg) * 100) / 100;
}

export const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  regular: '정상가',
  sale: '할인가',
  coupon: '쿠폰가',
};

export const PRICE_WARNING_LABEL: Record<PriceWarning, string> = {
  coupon_excluded: '쿠폰 적용 조건 미확인·불충족 → 최저가 계산에서 제외',
  sale_gt_regular: '할인가가 정상가보다 높게 표기됨 (검토 필요)',
};
