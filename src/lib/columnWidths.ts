import { useCallback, useState } from 'react';

/** 상품 표 열 키. 품목(탭)별로 사용자가 조절한 너비(px)를 기억한다. */
export type ColumnKey =
  | 'name'
  | 'order'
  | 'cutoff'
  | 'delivery'
  | 'weight'
  | 'pieces'
  | 'regular'
  | 'sale'
  | 'coupon'
  | 'unit'
  | 'shipping'
  | 'status'
  | 'actions'
  | 'source';

export type ColumnWidths = Partial<Record<ColumnKey, number>>;

/** 기본 너비. 상품명은 기본값이 없고 남는 폭을 모두 차지한다. */
export const DEFAULT_COLUMN_WIDTH: Record<Exclude<ColumnKey, 'name'>, number> = {
  order: 68,
  cutoff: 80,
  delivery: 140,
  weight: 112,
  pieces: 72,
  regular: 88,
  sale: 88,
  coupon: 96,
  unit: 116,
  shipping: 124,
  status: 96,
  actions: 208,
  source: 112,
};

export const MIN_COLUMN_WIDTH = 48;
export const MIN_NAME_WIDTH = 120;
export const MAX_COLUMN_WIDTH = 900;

const KEY_PREFIX = 'fpr-colw:';

function read(categoryId: string): ColumnWidths {
  try {
    const v = localStorage.getItem(KEY_PREFIX + categoryId);
    const parsed = v ? (JSON.parse(v) as unknown) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: ColumnWidths = {};
    for (const [k, w] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof w === 'number' && Number.isFinite(w)) out[k as ColumnKey] = w;
    }
    return out;
  } catch {
    return {};
  }
}

function write(categoryId: string, w: ColumnWidths) {
  try {
    if (Object.keys(w).length === 0) localStorage.removeItem(KEY_PREFIX + categoryId);
    else localStorage.setItem(KEY_PREFIX + categoryId, JSON.stringify(w));
  } catch {
    /* 저장 불가 시 이번 화면에서만 유지 */
  }
}

export function clampWidth(key: ColumnKey, w: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(key === 'name' ? MIN_NAME_WIDTH : MIN_COLUMN_WIDTH, w)));
}

/** 품목별 열 너비. 바꾼 너비는 이 브라우저에 저장되어 다시 바꾸기 전까지 유지된다. */
export function useColumnWidths(categoryId: string | null) {
  const [state, setState] = useState<{ id: string | null; widths: ColumnWidths }>(() => ({
    id: categoryId,
    widths: categoryId ? read(categoryId) : {},
  }));
  // 탭이 바뀌면 그 탭의 저장값으로 교체 (렌더 중 동기화)
  let current = state;
  if (state.id !== categoryId) {
    current = { id: categoryId, widths: categoryId ? read(categoryId) : {} };
    setState(current);
  }

  const update = useCallback(
    (fn: (w: ColumnWidths) => ColumnWidths) =>
      setState((s) => {
        const next = fn(s.widths);
        if (s.id) write(s.id, next);
        return { ...s, widths: next };
      }),
    [],
  );

  const setWidth = useCallback((key: ColumnKey, w: number) => update((prev) => ({ ...prev, [key]: clampWidth(key, w) })), [update]);
  const resetWidth = useCallback(
    (key: ColumnKey) =>
      update((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      }),
    [update],
  );
  const resetAll = useCallback(() => update(() => ({})), [update]);

  return { widths: current.widths, setWidth, resetWidth, resetAll, customized: Object.keys(current.widths).length > 0 };
}
