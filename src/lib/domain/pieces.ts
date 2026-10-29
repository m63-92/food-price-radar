/**
 * 개수 해석 (계란 '30구', 배추 '3입' 등). crawler/normalize.py 의 parse_pieces 와 동일 규칙,
 * tests/vectors/piece_cases.json 공용 벡터를 통과해야 한다.
 * 망·박스·봉·판은 포장 단위라 개수로 세지 않고, 'N구 x M판' 처럼 곱해질 때만 반영한다.
 */
export type PieceStatus = 'ok' | 'missing' | 'ambiguous';

export interface PieceParseResult {
  count: number | null;
  label: string | null;
  status: PieceStatus;
}

const PIECE_RE = /(\d+)\s*(개입|구|알|입|개|포기|단|송이)(?![가-힣])/g;
const RANGE_BEFORE_RE = /\d+\s*~\s*$/;
const APPROX_BEFORE_RE = /약\s*$/;
const APPROX_AFTER_RE = /^\s*(내외|이상|이하|전후|정도|안팎)/;
const MULT_RE = /^\s*(?:x|\*)\s*(\d+)\s*(?:판|봉|팩|박스|box|망|세트)?/;

export function parsePieces(text: string | null | undefined): PieceParseResult {
  if (!text || !text.trim()) return { count: null, label: null, status: 'missing' };
  const s = text.normalize('NFKC').toLowerCase().replace(/[×✕✖]/g, 'x');
  const found: Array<{ count: number; label: string; approx: boolean }> = [];
  for (const m of s.matchAll(PIECE_RE)) {
    const start = m.index ?? 0;
    const before = s.slice(0, start);
    const after = s.slice(start + m[0].length);
    if (/번\s*$/.test(before)) continue;
    const approx = RANGE_BEFORE_RE.test(before) || APPROX_BEFORE_RE.test(before) || APPROX_AFTER_RE.test(after);
    const mult = MULT_RE.exec(after);
    const label = m[2] === '개입' ? '입' : m[2];
    found.push({ count: Number(m[1]) * (mult ? Number(mult[1]) : 1), label, approx });
  }
  if (found.length === 0) return { count: null, label: null, status: 'missing' };
  if (found.some((f) => f.approx)) return { count: null, label: null, status: 'ambiguous' };
  const counts = [...new Set(found.map((f) => f.count))];
  if (counts.length > 1 || !(counts[0] > 0)) return { count: null, label: null, status: 'ambiguous' };
  return { count: counts[0], label: found[0].label, status: 'ok' };
}
