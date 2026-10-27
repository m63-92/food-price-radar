import { describe, expect, it } from 'vitest';
import { formatKrw, formatKst, formatPct, formatSignedKrw, formatUnitPrice, kstDayKey, shippingLabel } from './format';

describe('표시 형식', () => {
  it('원화/단가', () => {
    expect(formatKrw(7900)).toBe('₩7,900');
    expect(formatKrw(null)).toBe('-');
    expect(formatKrw(0)).toBe('₩0');
    expect(formatUnitPrice(7900)).toBe('₩7,900/kg');
    expect(formatUnitPrice(7900, '100g')).toBe('₩790/100g');
    expect(formatUnitPrice(null)).toBe('-');
  });
  it('택배비: 무료 / 유료 / 금액 미확인 / 미확인 구분', () => {
    expect(shippingLabel('free', null)).toBe('무료');
    expect(shippingLabel('paid', 3000)).toBe('유료 (₩3,000)');
    expect(shippingLabel('paid', null)).toBe('유료 (금액 미확인)');
    expect(shippingLabel('unknown', null)).toBe('-');
  });
  it('KST 변환', () => {
    expect(formatKst('2026-10-27T05:35:00Z')).toBe('2026-10-27 14:35');
    expect(kstDayKey('2026-10-09T15:30:00Z')).toBe('2026-10-10');
    expect(formatKst(null)).toBe('-');
  });
  it('등락 텍스트(색상만으로 구분하지 않음)', () => {
    expect(formatSignedKrw(-2000, '/kg')).toBe('-2,000원/kg');
    expect(formatSignedKrw(500)).toBe('+500원');
    expect(formatPct(-20)).toBe('-20.0%');
    expect(formatPct(null)).toBe('-');
  });
});
