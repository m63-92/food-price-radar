/**
 * 중량 정규화 (명세 5.3). crawler/normalize.py 의 parse_weight 와 동일한 규칙이며
 * 두 구현 모두 tests/vectors/weight_cases.json 을 통과해야 한다.
 *
 * - g ↔ kg 만 변환한다. ml/L 은 밀도를 모르므로 환산하지 않는다.
 * - 숫자마다 성격을 따진다:
 *     · '개당 250g', '2번구 230g', '150~180g/개' → 알 1개 크기(총중량 아님, 무시)
 *     · '(±200g)' → 허용오차 표기(무시하되 앞의 총중량을 근사로 만든다)
 *     · '약 8kg', '8kg내외', '14~15kg', '180g이상' → 근사/범위
 * - 정확한 총중량이 하나로 정해지면 그 값을 쓴다. 정확한 값보다 훨씬 작은 근사 표기(예: '15kg (180g이상)')는
 *   알 크기 설명으로 보고 무시한다. 총중량 자체가 근사/범위이거나 서로 다른 총중량이 있으면 null(검토 대상).
 */
export type WeightStatus = 'ok' | 'missing' | 'ambiguous' | 'unsupported_unit';

export interface WeightParseResult {
  kg: number | null;
  status: WeightStatus;
  /** 총중량이 근사/범위로만 표기된 경우 그 범위(kg). 옵션 중량 검증에 쓴다 */
  approxRange?: [number, number];
}

const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(kg|킬로그램|킬로|키로|g|그램)(?![a-z])/g;
const VOLUME_RE = /(\d+(?:\.\d+)?)\s*(ml|㎖|ℓ|l|리터)(?![a-z])/;
const RANGE_BEFORE_RE = /(\d+(?:\.\d+)?)\s*(kg|킬로그램|킬로|키로|g|그램)?\s*~\s*$/;
const APPROX_BEFORE_RE = /약\s*$/;
const APPROX_AFTER_RE = /^\s*(내외|이상|이하|전후|정도|안팎|\(?\s*±)/;
const TOLERANCE_BEFORE_RE = /(±|\+-|\+\/-)\s*$/;
const PIECE_BEFORE_RE = /(개당|개\s+당|\d+\s*번구)\s*$/;
const PIECE_AFTER_RE = /^\s*\/\s*개(?![입])/;
const MULT_X_RE = /^\s*(?:x|\*)\s*(\d+)/;
const MULT_COUNT_RE = /^\s+(\d+)\s*(?:개|봉지|봉|팩|입|ea|통|망|박스|box|pack)/;

export function normalizeWeightText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/[×✕✖]/g, 'x');
}

const toKg = (value: number, unit: string | undefined) => (unit === 'g' || unit === '그램' ? value / 1000 : value);

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

interface WeightToken {
  total: number;
  lo: number;
  hi: number;
  approx: boolean;
}

export function parseWeight(text: string | null | undefined): WeightParseResult {
  if (!text || !text.trim()) return { kg: null, status: 'missing' };
  const s = normalizeWeightText(text);
  const matches = [...s.matchAll(WEIGHT_RE)];
  if (matches.length === 0) {
    return { kg: null, status: VOLUME_RE.test(s) ? 'unsupported_unit' : 'missing' };
  }
  if (VOLUME_RE.test(s)) return { kg: null, status: 'ambiguous' };

  const tokens: WeightToken[] = [];
  for (const m of matches) {
    const start = m.index ?? 0;
    const before = s.slice(0, start);
    const after = s.slice(start + m[0].length);
    if (TOLERANCE_BEFORE_RE.test(before)) continue; // '±200g' 자체는 무시
    if (PIECE_BEFORE_RE.test(before) || PIECE_AFTER_RE.test(after)) continue; // 알 1개 크기
    const unit = m[2];
    const kg = toKg(Number(m[1]), unit);
    const range = RANGE_BEFORE_RE.exec(before);
    const approx = !!range || APPROX_BEFORE_RE.test(before) || APPROX_AFTER_RE.test(after);
    const mult = approx ? null : (MULT_X_RE.exec(after) ?? MULT_COUNT_RE.exec(after));
    const count = mult ? Number(mult[1]) : 1;
    const total = round6(kg * count);
    const lo = range ? round6(toKg(Number(range[1]), range[2] ?? unit)) : approx ? round6(total * 0.9) : total;
    const hi = approx && !range ? round6(total * 1.1) : total;
    tokens.push({ total, lo: Math.min(lo, hi), hi: Math.max(lo, hi), approx });
  }
  // 알 1개 크기·오차 표기뿐이면 총중량 정보가 없는 것
  if (tokens.length === 0) return { kg: null, status: 'missing' };

  const exact = [...new Set(tokens.filter((t) => !t.approx).map((t) => t.total))];
  const approx = tokens.filter((t) => t.approx);
  if (exact.length > 1) return { kg: null, status: 'ambiguous' };
  if (exact.length === 1) {
    const kg = exact[0];
    if (!(kg > 0)) return { kg: null, status: 'ambiguous' };
    // 총중량 수준의 근사 표기가 함께 있으면(예: '15kg, 14~15kg내외') 확정하지 않는다
    if (approx.some((t) => t.hi >= kg * 0.5)) {
      return { kg: null, status: 'ambiguous', approxRange: [Math.min(...approx.map((t) => t.lo)), Math.max(...approx.map((t) => t.hi))] };
    }
    return { kg, status: 'ok' };
  }
  const big = approx.filter((t) => t.hi > 0);
  if (big.length === 0) return { kg: null, status: 'ambiguous' };
  return { kg: null, status: 'ambiguous', approxRange: [Math.min(...big.map((t) => t.lo)), Math.max(...big.map((t) => t.hi))] };
}

export function formatWeightKg(kg: number | null): string {
  if (kg == null) return '-';
  if (kg < 1) return `${round6(kg * 1000)}g`;
  return `${round6(kg)}kg`;
}
