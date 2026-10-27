import type { ShippingStatus } from '../../types';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const krw = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

export type UnitBasis = 'kg' | '100g';

/** 값이 없으면 숫자 0 이 아닌 '-' (명세 5.1) */
export function formatKrw(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return `₩${krw.format(Math.round(n))}`;
}

export function formatUnitPrice(perKg: number | null | undefined, basis: UnitBasis = 'kg'): string {
  if (perKg == null || !Number.isFinite(perKg)) return '-';
  return basis === 'kg' ? `₩${krw.format(Math.round(perKg))}/kg` : `₩${krw.format(Math.round(perKg / 10))}/100g`;
}

export function formatSignedKrw(n: number | null, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const r = Math.round(n);
  const sign = r > 0 ? '+' : r < 0 ? '-' : '±';
  return `${sign}${krw.format(Math.abs(r))}원${suffix}`;
}

export function formatPct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '-';
  const r = Math.round(p * 10) / 10;
  const sign = r > 0 ? '+' : r < 0 ? '-' : '±';
  return `${sign}${Math.abs(r).toFixed(1)}%`;
}

/** UTC ISO → 'YYYY-MM-DD HH:mm' (Asia/Seoul). 한국은 DST 가 없어 +9h 고정 */
export function formatKst(iso: string | null | undefined): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '-';
  const d = new Date(t + KST_OFFSET_MS).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}

export function formatKstShort(iso: string): string {
  const d = new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString();
  return `${d.slice(5, 7)}/${d.slice(8, 10)} ${d.slice(11, 16)}`;
}

/** UTC ISO → KST 날짜 키 'YYYY-MM-DD' */
export function kstDayKey(iso: string | number): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function shippingLabel(status: ShippingStatus, priceKrw: number | null): string {
  if (status === 'free') return '무료';
  if (status === 'paid') return priceKrw != null ? `유료 (${formatKrw(priceKrw)})` : '유료 (금액 미확인)';
  return '-';
}

export function parseKrwInput(v: string): number | null {
  const s = v.replace(/[₩,\s원]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}
