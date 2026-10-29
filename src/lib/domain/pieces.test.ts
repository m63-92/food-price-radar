import { describe, expect, it } from 'vitest';
import vectors from '../../../tests/vectors/piece_cases.json';
import { parsePieces } from './pieces';

describe('parsePieces (공유 벡터)', () => {
  for (const c of vectors.cases) {
    it(`${JSON.stringify(c.text)} → ${c.count ?? '-'} (${c.status})`, () => {
      const r = parsePieces(c.text);
      expect(r.status).toBe(c.status);
      expect(r.count).toBe(c.count);
      expect(r.label).toBe(c.label);
    });
  }
});
