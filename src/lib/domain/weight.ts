/**
 * 중량 정규화 (명세 5.3). crawler/normalize.py 의 parse_weight 와 동일한 규칙이며
 * 두 구현 모두 tests/vectors/weight_cases.json 을 통과해야 한다.
 *
 * - g ↔ kg 만 변환한다. ml/L 은 밀도를 모르므로 환산하지 않는다.
 * - '약', '~', '내외', '±' 등 범위·근사 표기는 신뢰할 수 없으므로 null(검토 대상).
 * - 서로 다른 중량이 함께 표기되면 충돌로 보고 null.
 */
export type WeightStatus = 'ok' | 'missing' | 'ambiguous' | 'unsupported_unit';

export interface WeightParseResult {
  kg: number | null;
  status: WeightStatus;
}

const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(kg|킬로그램|킬로|키로|g|그램)(?![a-z])/g;
const VOLUME_RE = /(\d+(?:\.\d+)?)\s*(ml|㎖|ℓ|l|리터)(?![a-z])/;
const AMBIGUOUS_RE = /~|내외|약|±|이상|이하|전후|정도|개당/;
const MULT_X_RE = /^\s*(?:x|\*)\s*(\d+)/;
const MULT_COUNT_RE = /^\s+(\d+)\s*(?:개|봉지|봉|팩|입|ea|통|망|박스|box|pack)/;

export function normalizeWeightText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/[×✕✖]/g, 'x');
}

export function parseWeight(text: string | null | undefined): WeightParseResult {
  if (!text || !text.trim()) return { kg: null, status: 'missing' };
  const s = normalizeWeightText(text);
  const tokens = [...s.matchAll(WEIGHT_RE)];
  if (tokens.length === 0) {
    return { kg: null, status: VOLUME_RE.test(s) ? 'unsupported_unit' : 'missing' };
  }
  if (AMBIGUOUS_RE.test(s) || VOLUME_RE.test(s)) return { kg: null, status: 'ambiguous' };

  const totals = new Set<number>();
  const bases = new Set<number>();
  for (const m of tokens) {
    const value = Number(m[1]);
    const unit = m[2];
    const baseKg = unit === 'g' || unit === '그램' ? value / 1000 : value;
    const rest = s.slice((m.index ?? 0) + m[0].length);
    const mult = MULT_X_RE.exec(rest) ?? MULT_COUNT_RE.exec(rest);
    const count = mult ? Number(mult[1]) : 1;
    bases.add(round6(baseKg));
    totals.add(round6(baseKg * count));
  }
  if (bases.size > 1 || totals.size > 1) return { kg: null, status: 'ambiguous' };
  const kg = [...totals][0];
  if (!(kg > 0)) return { kg: null, status: 'ambiguous' };
  return { kg, status: 'ok' };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function formatWeightKg(kg: number | null): string {
  if (kg == null) return '-';
  if (kg < 1) return `${round6(kg * 1000)}g`;
  return `${round6(kg)}kg`;
}
