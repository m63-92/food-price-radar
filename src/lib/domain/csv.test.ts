import { describe, expect, it } from 'vitest';
import { parseCsv, parseImportCsv, toCsv } from './csv';

describe('CSV', () => {
  it('왕복 변환 (따옴표/쉼표/줄바꿈)', () => {
    const text = toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['line\nbreak', null]]);
    expect(parseCsv(text)).toEqual([['a', 'b'], ['x,y', 'say "hi"'], ['line\nbreak', '']]);
  });
  it('가져오기: 빈 값은 null, 중량 원문 파싱', () => {
    const csv =
      'source,title,source_url,raw_weight_text,regular_price_krw,sale_price_krw,shipping_status\n' +
      'naver,깐마늘,https://example.invalid/1,500g × 2봉,"10,000",,free';
    const { rows, errors } = parseImportCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].source).toBe('naver');
    expect(rows[0].fields.weightKg).toBe(1);
    expect(rows[0].fields.regularPriceKrw).toBe(10000);
    expect(rows[0].fields.salePriceKrw).toBeNull();
    expect(rows[0].fields.shippingStatus).toBe('free');
  });
});
