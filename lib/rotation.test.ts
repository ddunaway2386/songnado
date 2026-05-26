import { selectNextIndex } from './rotation';

function seq(start: number, end: number) {
  return Array.from({ length: end - start }, (_, i) => start + i);
}

describe('selectNextIndex', () => {
  test('picks an index in range when pool has room', () => {
    const result = selectNextIndex([], 10, () => 0);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(0);
    expect(result!.nextPlayed).toEqual([0]);
    expect(result!.didReset).toBe(false);
  });

  test('never repeats an already-played index', () => {
    let played: number[] = [];
    const total = 20;
    for (let i = 0; i < total; i++) {
      const r = selectNextIndex(played, total)!;
      expect(played).not.toContain(r.index);
      expect(r.didReset).toBe(false);
      played = r.nextPlayed;
    }
    expect(played.sort((a, b) => a - b)).toEqual(seq(0, total));
  });

  test('auto-resets and sets didReset when pool is exhausted', () => {
    const played = seq(0, 10);
    const r = selectNextIndex(played, 10)!;
    expect(r.didReset).toBe(true);
    expect(r.index).toBeGreaterThanOrEqual(0);
    expect(r.index).toBeLessThan(10);
    expect(r.nextPlayed).toEqual([r.index]);
  });

  test('draws without replacement across a full cycle plus reset', () => {
    const total = 5;
    let played: number[] = [];
    const drawn: number[] = [];
    for (let i = 0; i < total; i++) {
      const r = selectNextIndex(played, total)!;
      expect(r.didReset).toBe(false);
      drawn.push(r.index);
      played = r.nextPlayed;
    }
    expect(new Set(drawn).size).toBe(total);

    const afterReset = selectNextIndex(played, total)!;
    expect(afterReset.didReset).toBe(true);
    expect(afterReset.nextPlayed).toHaveLength(1);
  });

  test('returns null for invalid totals', () => {
    expect(selectNextIndex([], 0)).toBeNull();
    expect(selectNextIndex([], -1)).toBeNull();
  });
});
