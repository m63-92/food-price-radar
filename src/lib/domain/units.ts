import type { UnitBasis } from '../../types';
import { formatUnitPrice, type UnitView } from './format';

/** 품목 단가 기준(kg / 개수)에 맞는 단가 값 */
export function unitOf(r: { unitPriceKrwPerKg: number | null; unitPriceKrwPerPiece: number | null }, basis: UnitBasis): number | null {
  return basis === 'piece' ? r.unitPriceKrwPerPiece : r.unitPriceKrwPerKg;
}

export function unitSuffix(basis: UnitBasis, pieceLabel: string): string {
  return basis === 'piece' ? pieceLabel : 'kg';
}

/** '₩7,000/kg' · '₩700/100g' · '₩189/알' */
export function formatUnit(v: number | null | undefined, basis: UnitBasis, pieceLabel: string, view: UnitView = 'kg'): string {
  if (basis === 'kg') return formatUnitPrice(v, view);
  if (v == null || !Number.isFinite(v)) return '-';
  return `₩${Math.round(v).toLocaleString('ko-KR')}/${pieceLabel}`;
}
