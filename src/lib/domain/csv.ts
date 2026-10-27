import type { Availability, EditableFields, ShippingStatus, Source } from '../../types';
import { parseWeight } from './weight';

const BOM = String.fromCharCode(0xfeff);

export function toCsv(header: string[], rows: Array<Array<unknown>>): string {
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM: 엑셀에서 한글이 깨지지 않도록
  return BOM + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = (text.startsWith(BOM) ? text.slice(1) : text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const IMPORT_COLUMNS = [
  'source',
  'title',
  'source_url',
  'seller',
  'product_option',
  'raw_weight_text',
  'weight_kg',
  'regular_price_krw',
  'sale_price_krw',
  'coupon_price_krw',
  'coupon_eligible',
  'coupon_conditions',
  'shipping_status',
  'shipping_price_krw',
] as const;

export interface ImportRow {
  source: Source;
  fields: EditableFields;
}

const num = (v: string | undefined): number | null => {
  if (v == null || v.trim() === '' || v.trim() === '-') return null;
  const n = Number(v.replace(/[₩,원\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** CSV 가져오기: 수집이 제한된 제공처(네이버/쿠팡 등) 가격을 관리자가 확인 후 일괄 등록 */
export function parseImportCsv(text: string): { rows: ImportRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length < 2) return { rows: [], errors: ['헤더와 1개 이상의 데이터 행이 필요합니다.'] };
  const header = table[0].map((h) => h.trim());
  const idx = (k: string) => header.indexOf(k);
  if (idx('title') < 0 || idx('source_url') < 0) errors.push('title, source_url 열은 필수입니다.');
  const rows: ImportRow[] = [];
  table.slice(1).forEach((r, i) => {
    const get = (k: string) => (idx(k) >= 0 ? r[idx(k)]?.trim() : undefined);
    const title = get('title');
    const url = get('source_url');
    if (!title || !url) {
      errors.push(`${i + 2}행: 상품명 또는 URL 누락`);
      return;
    }
    const srcRaw = (get('source') || 'manual') as Source;
    const source: Source = ['foodspring', 'naver', 'coupang', 'manual'].includes(srcRaw) ? srcRaw : 'manual';
    const rawWeightText = get('raw_weight_text') || null;
    const weightKg = num(get('weight_kg')) ?? parseWeight(rawWeightText).kg;
    const ship = (get('shipping_status') || 'unknown') as ShippingStatus;
    const eligible = get('coupon_eligible');
    rows.push({
      source,
      fields: {
        title,
        sourceUrl: url,
        seller: get('seller') || null,
        productOption: get('product_option') || null,
        rawWeightText,
        weightKg,
        regularPriceKrw: num(get('regular_price_krw')),
        salePriceKrw: num(get('sale_price_krw')),
        couponPriceKrw: num(get('coupon_price_krw')),
        couponEligible: eligible === 'true' ? true : eligible === 'false' ? false : null,
        couponConditions: get('coupon_conditions') || null,
        shippingStatus: ['free', 'paid', 'unknown'].includes(ship) ? ship : 'unknown',
        shippingPriceKrw: num(get('shipping_price_krw')),
        availability: 'unknown' as Availability,
      },
    });
  });
  return { rows, errors };
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
