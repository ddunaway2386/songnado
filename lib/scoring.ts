import type { GameMode, Team } from './types';

export const PREVIEW_DURATION_S = 30;
export const NO_ANSWER_PENALTY_BLITZ = -30;
export const NO_ANSWER_PENALTY_CLASSIC = -2;

export interface TargetScoreBounds {
  min: number;
  max: number;
  step: number;
  default: number;
}

export function targetScoreBounds(mode: GameMode): TargetScoreBounds {
  if (mode === 'blitz') return { min: 100, max: 500, step: 50, default: 300 };
  return { min: 5, max: 25, step: 1, default: 15 };
}

/**
 * Round-points calculator for Classic / Blitz.
 *
 * Classic: flat — 3 (both correct), 1 (one correct), 0 (neither).
 * Blitz: same base × (30 − timeUsed), where timeUsed is clamped to [0, 30].
 *
 * Wrong guesses are 0 points (the FF reference's −30 multiplier is dropped —
 * tension comes from the timer in Blitz and from the no-answer penalty when
 * nobody buzzes). Negative-zero is normalized to 0.
 */
export function calculateRoundPoints(
  songCorrect: boolean,
  artistCorrect: boolean,
  timeUsed: number,
  mode: GameMode
): number {
  let base: number;
  if (songCorrect && artistCorrect) base = 3;
  else if (songCorrect || artistCorrect) base = 1;
  else base = 0;

  if (mode !== 'blitz') return base;

  const capped = Math.max(0, Math.min(PREVIEW_DURATION_S, timeUsed));
  const raw = base * (PREVIEW_DURATION_S - capped);
  return raw === 0 ? 0 : raw;
}

export function noAnswerPenalty(mode: GameMode): number {
  if (mode === 'blitz') return NO_ANSWER_PENALTY_BLITZ;
  if (mode === 'classic') return NO_ANSWER_PENALTY_CLASSIC;
  return 0; // Elimination has no point-based penalty
}

export function findWinnerIndex(teams: Team[], targetScore: number): number | null {
  if (targetScore <= 0 || teams.length === 0) return null;
  let bestIndex: number | null = null;
  let bestScore = -Infinity;
  for (const team of teams) {
    if (team.score >= targetScore && team.score > bestScore) {
      bestScore = team.score;
      bestIndex = team.index;
    }
  }
  return bestIndex;
}

/** Elimination winner: first team to have cleared every selected playlist. */
export function findEliminationWinner(
  teams: Team[],
  selectedPlaylistIds: string[]
): number | null {
  if (selectedPlaylistIds.length === 0) return null;
  const required = new Set(selectedPlaylistIds);
  for (const team of teams) {
    const cleared = new Set(team.completedPlaylists);
    let hasAll = true;
    for (const id of required) {
      if (!cleared.has(id)) {
        hasAll = false;
        break;
      }
    }
    if (hasAll) return team.index;
  }
  return null;
}
