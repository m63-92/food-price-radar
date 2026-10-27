import { describe, expect, it } from 'vitest';
import vectors from '../../../tests/vectors/weight_cases.json';
import { parseWeight } from './weight';

describe('parseWeight (공유 벡터)', () => {
  for (const c of vectors.cases) {
    it(`${JSON.stringify(c.text)} → ${c.kg ?? '-'} (${c.status})`, () => {
      const r = parseWeight(c.text);
      expect(r.status).toBe(c.status);
      expect(r.kg).toBe(c.kg);
    });
  }
});
