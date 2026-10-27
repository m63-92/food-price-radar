/**
 * 차트 색상 — dataviz 참조 팔레트의 범주형 순서를 고정 사용(순환 금지, 엔터티에 고정).
 * 인접 쌍 CVD ΔE ≥ 8 검증된 순서. 9번째 이후 시리즈는 새 색을 만들지 않고 점선 패턴으로 구분한다.
 */
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export function seriesStyle(index: number): { color: string; dash?: string } {
  const color = CATEGORICAL[index % CATEGORICAL.length];
  return index < CATEGORICAL.length ? { color } : { color, dash: '2 3' };
}

/** 상품 가격 이력 시리즈별 고정 색 */
export const HISTORY_COLORS = {
  best: CATEGORICAL[0],
  sale: CATEGORICAL[1],
  regular: CATEGORICAL[2],
  coupon: CATEGORICAL[3],
  unit: CATEGORICAL[0],
} as const;

export const AXIS = { tick: '#64748b', grid: '#e2e8f0', font: 11 };

/** 깔끔한 눈금 간격(1·2·2.5·5 × 10^n)으로 Y축 범위와 눈금을 계산한다. 값이 없으면 recharts 기본값 */
export function niceScale(values: Array<number | null | undefined>): { domain: [number, number] | ['auto', 'auto']; ticks?: number[] } {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return { domain: ['auto', 'auto'] };
  let min = Math.min(...v);
  let max = Math.max(...v);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 100);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
  const lo = Math.max(0, Math.floor(min / step) * step);
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t));
  return { domain: [lo, hi], ticks };
}

export const krwTick = (v: number) => v.toLocaleString('ko-KR');
