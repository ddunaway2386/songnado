import {
  applySuddenDeathWin,
  isSuddenDeathResolved,
  tiedLeaders,
  type SuddenDeathState,
} from './suddenDeath';

const fresh = (contenders: string[]): SuddenDeathState => ({
  contenders,
  safe: [],
  out: [],
});

describe('tiedLeaders', () => {
  test('no tie when one team is ahead', () => {
    expect(tiedLeaders({ a: 3, b: 2, c: 1 })).toEqual([]);
  });

  test('finds teams level at the top, ignoring those below', () => {
    expect(tiedLeaders({ a: 2, b: 2, c: 1 }).sort()).toEqual(['a', 'b']);
  });

  test('a three-way tie returns all three', () => {
    expect(tiedLeaders({ a: 2, b: 2, c: 2 }).sort()).toEqual(['a', 'b', 'c']);
  });

  test('everyone on zero is still a tie that needs settling', () => {
    expect(tiedLeaders({ a: 0, b: 0 }).sort()).toEqual(['a', 'b']);
  });

  test('a single team cannot tie with itself', () => {
    expect(tiedLeaders({ a: 5 })).toEqual([]);
  });
});

describe('two-team sudden death', () => {
  test('first correct answer wins outright', () => {
    const next = applySuddenDeathWin(fresh(['a', 'b']), 'a');
    expect(next.contenders).toEqual(['a']);
    expect(next.out).toEqual(['b']);
    expect(isSuddenDeathResolved(next)).toBe(true);
  });

  test('the loser is ranked below the winner', () => {
    const next = applySuddenDeathWin(fresh(['a', 'b']), 'b');
    expect(next.out).toEqual(['a']);
  });
});

describe('three-team sudden death', () => {
  test('a correct answer only buys safety — nobody is out yet', () => {
    const next = applySuddenDeathWin(fresh(['a', 'b', 'c']), 'a');
    expect(next.contenders.sort()).toEqual(['a', 'b', 'c']);
    expect(next.safe).toEqual(['a']);
    expect(next.out).toEqual([]);
    expect(isSuddenDeathResolved(next)).toBe(false);
  });

  test('second team through knocks out the last one left', () => {
    let s = fresh(['a', 'b', 'c']);
    s = applySuddenDeathWin(s, 'a');
    s = applySuddenDeathWin(s, 'b');
    expect(s.out).toEqual(['c']);
    expect(s.contenders.sort()).toEqual(['a', 'b']);
    // Survivors start a clean cycle rather than carrying safety over.
    expect(s.safe).toEqual([]);
  });

  test('plays all the way down to one winner', () => {
    let s = fresh(['a', 'b', 'c']);
    s = applySuddenDeathWin(s, 'a'); // a safe
    s = applySuddenDeathWin(s, 'b'); // b safe -> c out, reset to a vs b
    s = applySuddenDeathWin(s, 'b'); // head-to-head: b wins
    expect(isSuddenDeathResolved(s)).toBe(true);
    expect(s.contenders).toEqual(['b']);
    // Knocked out earliest first: c placed third, a second.
    expect(s.out).toEqual(['c', 'a']);
  });
});

describe('four-team sudden death', () => {
  test('takes three survivals to knock the first team out', () => {
    let s = fresh(['a', 'b', 'c', 'd']);
    s = applySuddenDeathWin(s, 'a');
    expect(s.out).toEqual([]);
    s = applySuddenDeathWin(s, 'b');
    expect(s.out).toEqual([]);
    s = applySuddenDeathWin(s, 'c');
    expect(s.out).toEqual(['d']);
    expect(s.contenders.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('robustness', () => {
  test('a win from a non-contender is ignored', () => {
    const s = fresh(['a', 'b']);
    expect(applySuddenDeathWin(s, 'zzz')).toEqual(s);
  });

  test('the same team winning twice in a cycle does not double-count', () => {
    let s = fresh(['a', 'b', 'c']);
    s = applySuddenDeathWin(s, 'a');
    s = applySuddenDeathWin(s, 'a');
    expect(s.safe).toEqual(['a']);
    expect(s.out).toEqual([]);
  });

  test('does not mutate the state it is given', () => {
    const s = fresh(['a', 'b', 'c']);
    const snapshot = JSON.stringify(s);
    applySuddenDeathWin(s, 'a');
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
