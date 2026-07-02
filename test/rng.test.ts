import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng';

describe('Rng', () => {
  it('is deterministic: same seed gives same sequence', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('different seeds give different sequences', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays in [0, 1)', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() covers the full inclusive range', () => {
    const rng = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rng.int(1, 4);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });

  it('pick() returns elements from the array', () => {
    const rng = new Rng(3);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(arr).toContain(rng.pick(arr));
  });

  it('shuffle() preserves elements', () => {
    const rng = new Rng(11);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle([...arr]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(arr);
  });

  it('weighted() respects zero weights', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) {
      expect(rng.weighted(['a', 'b'], [0, 1])).toBe('b');
    }
  });
});
