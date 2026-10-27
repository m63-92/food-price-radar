import { describe, expect, it } from 'vitest';
import vectors from '../../../tests/vectors/pricing_cases.json';
import { computeBestPrice, computeUnitPrice } from './pricing';

describe('최저 유효 상품가·원/kg (공유 벡터)', () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const r = computeBestPrice({
        regularPriceKrw: c.regular,
        salePriceKrw: c.sale,
        couponPriceKrw: c.coupon,
        couponEligible: c.couponEligible,
      });
      expect(r.bestPriceKrw).toBe(c.best);
      expect(r.kind).toBe(c.kind);
      expect([...r.warnings].sort()).toEqual([...c.warnings].sort());
      // 배송비(shippingPrice)는 계산 입력에 존재하지 않는다
      expect(computeUnitPrice(r.bestPriceKrw, c.weightKg)).toBe(c.unit);
    });
  }
});
