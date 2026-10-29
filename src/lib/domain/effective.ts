import type { EditableField, EditableFields, FieldOverride, PriceKind } from '../../types';
import { computeBestPrice, computeUnitPrice, type PriceWarning } from './pricing';

export const EDITABLE_FIELDS: EditableField[] = [
  'title',
  'seller',
  'productOption',
  'sourceUrl',
  'rawWeightText',
  'weightKg',
  'pieceCount',
  'regularPriceKrw',
  'salePriceKrw',
  'couponPriceKrw',
  'couponEligible',
  'couponConditions',
  'shippingStatus',
  'shippingPriceKrw',
  'availability',
];

export const FIELD_LABEL: Record<EditableField, string> = {
  title: '상품명',
  seller: '판매자',
  productOption: '옵션',
  sourceUrl: '상품 URL',
  rawWeightText: '중량 표기(원문)',
  weightKg: '정규화 총중량(kg)',
  pieceCount: '개수',
  regularPriceKrw: '정상가',
  salePriceKrw: '할인가',
  couponPriceKrw: '쿠폰가',
  couponEligible: '쿠폰 적용 가능',
  couponConditions: '쿠폰 조건',
  shippingStatus: '배송비 유무',
  shippingPriceKrw: '배송비 금액',
  availability: '재고',
};

/** DB(snake_case) 필드명 ↔ 앱 필드명. SQL fpr_apply_effective 와 동일한 키를 쓴다. */
export const FIELD_DB_NAME: Record<EditableField, string> = {
  title: 'title',
  seller: 'seller',
  productOption: 'product_option',
  sourceUrl: 'source_url',
  rawWeightText: 'raw_weight_text',
  weightKg: 'weight_kg',
  pieceCount: 'piece_count',
  regularPriceKrw: 'regular_price_krw',
  salePriceKrw: 'sale_price_krw',
  couponPriceKrw: 'coupon_price_krw',
  couponEligible: 'coupon_eligible',
  couponConditions: 'coupon_conditions',
  shippingStatus: 'shipping_status',
  shippingPriceKrw: 'shipping_price_krw',
  availability: 'availability',
};

export function applyOverrides(
  raw: EditableFields,
  overrides: Partial<Record<EditableField, FieldOverride>>,
): EditableFields {
  const eff = { ...raw } as Record<EditableField, unknown>;
  for (const f of EDITABLE_FIELDS) {
    const o = overrides[f];
    if (o) eff[f] = o.value;
  }
  return eff as unknown as EditableFields;
}

export interface Derived {
  bestPriceKrw: number | null;
  kind: PriceKind | null;
  unitPriceKrwPerKg: number | null;
  unitPriceKrwPerPiece: number | null;
  warnings: PriceWarning[];
}

export function derive(fields: EditableFields): Derived {
  const best = computeBestPrice(fields);
  return {
    bestPriceKrw: best.bestPriceKrw,
    kind: best.kind,
    unitPriceKrwPerKg: computeUnitPrice(best.bestPriceKrw, fields.weightKg),
    unitPriceKrwPerPiece: computeUnitPrice(best.bestPriceKrw, fields.pieceCount),
    warnings: best.warnings,
  };
}

/**
 * 자동 수집 결과 병합: 고정(lock)되지 않은 override 는 새 수집값으로 대체되고,
 * 고정된 override 만 남는다 (명세 7.3). crawler/reconcile.py 와 같은 규칙.
 */
export function mergeCrawl(
  overrides: Partial<Record<EditableField, FieldOverride>>,
): Partial<Record<EditableField, FieldOverride>> {
  const kept: Partial<Record<EditableField, FieldOverride>> = {};
  for (const f of EDITABLE_FIELDS) {
    const o = overrides[f];
    if (o?.isLocked) kept[f] = o;
  }
  return kept;
}
