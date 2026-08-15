/**
 * Sudden-death tie-break rules for buzz mode.
 *
 * Round-limited scoring makes ties common — five rounds between three teams
 * ties often — so the game needs a way to settle one rather than crowning
 * joint winners.
 *
 * Two rules, depending on how many teams are level:
 *
 *  - **Two teams**: rounds continue until one answers correctly. That team
 *    wins outright.
 *  - **Three or more**: a correct answer makes that team *safe* and it sits
 *    out the rest of the cycle. Rounds continue until exactly one contender
 *    is still unsafe; that team is knocked out, the survivors clear their
 *    safe flags, and a fresh cycle starts. Repeat down to two, then the
 *    head-to-head rule applies.
 *
 * Safe teams sitting out matters: without it a team that already survived
 * could keep winning rounds while the actual contest never resolves.
 *
 * No points are awarded — a tie-break shouldn't rewrite the scoreboard the
 * room just watched. Finishing order is carried by the knock-out order.
 */

export interface SuddenDeathState {
  /** Teams still contesting the tie. */
  contenders: string[];
  /** Contenders already through this cycle. */
  safe: string[];
  /** Knocked out, earliest first — i.e. last place first. */
  out: string[];
}

/**
 * Teams tied for the lead, or an empty array when someone is outright
 * ahead — the normal case, meaning no play-off is needed.
 *
 * A top score of zero counts: if nobody scored, everybody is level, and
 * that still needs settling rather than declaring "nobody wins".
 */
export function tiedLeaders(scores: Record<string, number>): string[] {
  const entries = Object.entries(scores);
  if (entries.length < 2) return [];
  const top = Math.max(...entries.map(([, v]) => v));
  const leaders = entries.filter(([, v]) => v === top).map(([id]) => id);
  return leaders.length > 1 ? leaders : [];
}

/** True once the play-off has produced a single winner. */
export function isSuddenDeathResolved(s: SuddenDeathState): boolean {
  return s.contenders.length <= 1;
}

/**
 * Apply a correct answer from `winnerId`. Returns the next state; the input
 * is not modified.
 */
export function applySuddenDeathWin(
  s: SuddenDeathState,
  winnerId: string
): SuddenDeathState {
  // Not a contender (shouldn't happen — they'd be locked out — but a
  // stale buzz shouldn't corrupt the bracket).
  if (!s.contenders.includes(winnerId)) return s;

  if (s.contenders.length <= 2) {
    return {
      contenders: [winnerId],
      safe: [],
      out: [...s.out, ...s.contenders.filter((id) => id !== winnerId)],
    };
  }

  const safe = s.safe.includes(winnerId) ? s.safe : [...s.safe, winnerId];
  const unsafe = s.contenders.filter((id) => !safe.includes(id));

  // Still more than one team to separate — keep playing this cycle.
  if (unsafe.length > 1) return { ...s, safe };

  // Exactly one left unsafe: they're out, and the survivors start over.
  return {
    contenders: s.contenders.filter((id) => id !== unsafe[0]),
    safe: [],
    out: [...s.out, ...unsafe],
  };
}
